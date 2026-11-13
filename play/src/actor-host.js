/** One tenant VM per runner Worker; many private actor Wasm instances inside it.
 *
 * Actor state is never shared: each actor is instantiated separately from the
 * already-compiled module, with its own globals and unshared linear memory.
 * The outer page owns the runner Worker and can terminate the entire tenant
 * on Stop or deadline. No nested actor Workers are created.
 *
 * Actor turns are non-reentrant, one at a time in fair FIFO/round-robin order.
 * A guest trap poisons that actor, but sibling actors can finish their queued
 * turns before the run reports its first fault. A CPU spin is NOT preemptible
 * within this tenant; the page must terminate the whole runner Worker.
 */
import { describePanic, guestImports } from './guest.js';

export const MAX_ACTORS = 16;
export const MAX_MAILBOX = 10_000;
const I64_MIN = -(2n ** 63n), I64_MAX = 2n ** 63n - 1n;

export function createActorHost({ module, names, out }) {
  if (!(module instanceof WebAssembly.Module)) throw new TypeError('actor host needs a compiled guest module');
  if (!Array.isArray(names) || !names.length) throw new Error('actor host needs an actor table');
  if (!out || typeof out.text !== 'string') throw new TypeError('actor host needs output');
  const actors = [];
  let closed = false, draining = false, spawned = 0, pending = 0;

  const label = a => `${a.name}#${a.ref}`;

  function spawn(type) {
    if (closed || draining) throw new Error('E_ACTOR: tenant VM is closed');
    if (!Number.isInteger(type) || type < 0 || type >= names.length) throw new Error('E_ACTOR: unknown actor type');
    if (spawned >= MAX_ACTORS) throw new Error(`E_ACTOR_LIMIT: at most ${MAX_ACTORS} actors per run`);

    // Distinct imports, instances, globals and linear memories for every actor.
    // The guest's actor_spawn/actor_send imports are intentionally denied here.
    const host = guestImports(module, out);
    const instance = new WebAssembly.Instance(module, host.imports);
    host.bind(instance);
    if (typeof instance.exports.actor_init !== 'function' ||
        typeof instance.exports.actor_receive !== 'function') {
      throw new Error('E_ACTOR: guest actor exports missing');
    }
    instance.exports.actor_init(type);
    const ref = spawned++;
    const actor = { ref, type, name: names[type], instance, queue: [], next: 0, sent: 0, failed: false };
    // A guest cannot supply imported memory (guestImports rejects it), but
    // assert private exported memories too, as a defense against ABI drift.
    for (const peer of actors) {
      if (instance.exports.memory && instance.exports.memory === peer.instance.exports.memory) {
        throw new Error('E_ISOLATION: shared actor memory');
      }
    }
    actors.push(actor);
    return ref;
  }

  function send(ref, value) {
    if (closed || draining) throw new Error('E_ACTOR: tenant VM is closed');
    const a = Number.isInteger(ref) ? actors[ref] : undefined;
    if (!a || a.failed) throw new Error('E_ACTOR: invalid actor reference');
    if (typeof value !== 'bigint' || value < I64_MIN || value > I64_MAX) {
      throw new Error('E_ACTOR: mail must be a signed 64-bit value');
    }
    if (a.sent >= MAX_MAILBOX) {
      throw new Error(`E_MAILBOX_FULL: actor ${label(a)} already has ${MAX_MAILBOX} messages`);
    }
    a.queue.push(value);
    a.sent++;
    pending++;
  }

  async function drain() {
    if (closed || draining) throw new Error('E_ACTOR: tenant VM is closed');
    draining = true;
    let fault = null;
    // One bounded turn per actor per sweep, preserving per-actor FIFO.
    while (pending > 0) {
      for (const a of actors) {
        if (a.failed || a.next >= a.queue.length) continue;
        const sequence = a.next;
        const value = a.queue[sequence];
        a.queue[sequence] = undefined;
        a.next++;
        pending--;
        try {
          a.instance.exports.actor_receive(a.type, value, BigInt(sequence));
        } catch (error) {
          if (!fault) fault = `${describePanic(a.instance, error)} in actor ${label(a)}`;
          a.failed = true;
          pending -= a.queue.length - a.next;
          a.queue.length = 0;
        }
      }
    }
    return fault;
  }

  function close() {
    if (closed) return;
    closed = true;
    for (const a of actors) {
      // Best-effort scrubbing; hard lifetime reclamation comes from the
      // page-owned outer Worker termination, NOT GC of Wasm instances.
      const memory = a.instance.exports.memory;
      if (memory instanceof WebAssembly.Memory && !(memory.buffer instanceof SharedArrayBuffer)) {
        new Uint8Array(memory.buffer).fill(0);
      }
      a.queue.length = 0;
    }
    actors.length = 0;
    pending = 0;
  }

  return { spawn, send, drain, close, get count() { return spawned; } };
}
