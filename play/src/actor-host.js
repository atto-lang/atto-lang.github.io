/**
 * Tenant-local actor scheduler for atto.browser.guest.v2.
 * One disposable runner Worker per run/tenant; one private Wasm instance
 * (including any module-defined memory and globals) per actor. No nested
 * workers, no shared actor memory, and no resumable Wasm stack switching yet.
 */
import { guestImports, describePanic } from './guest.js';

export const MAX_ACTORS = 16;
export const MAX_MAILBOX = 10_000;
export const MAX_ACTOR_MEMORY_BYTES = 64 * 1024 * 1024;
const I64_MIN = -(2n ** 63n), I64_MAX = 2n ** 63n - 1n;
const BATCH = 64;

export function createActorHost({ module, names, out, yieldTurn = () => new Promise(resolve => setTimeout(resolve, 0)) }) {
  if (!(module instanceof WebAssembly.Module)) throw new TypeError('actor host needs compiled guest module');
  if (!Array.isArray(names) || !names.length) throw new Error('actor host needs an actor table');
  if (!out || typeof out.text !== 'string') throw new TypeError('actor host needs an output collector');
  const actors = [];
  let closed = false, draining = false, drainPromise = null;
  const label = a => a.name + '#' + a.ref;

  function spawn(type) {
    if (closed || draining) throw new Error('E_ACTOR: actor host closed for admission');
    if (!Number.isInteger(type) || type < 0 || type >= names.length) throw new Error('E_ACTOR: unknown actor type');
    if (actors.length >= MAX_ACTORS) throw new Error('E_ACTOR_LIMIT: at most ' + MAX_ACTORS + ' actors per run');
    const ref = actors.length;
    actors.push({ ref, type, name: names[type], sent: 0, done: 0,
      mailbox: [], instance: null, memory: null });
    return ref;
  }

  function send(ref, value) {
    if (closed || draining) throw new Error('E_ACTOR: actor host closed for admission');
    const actor = Number.isInteger(ref) ? actors[ref] : undefined;
    if (!actor) throw new Error('E_ACTOR: invalid actor reference');
    if (typeof value !== 'bigint' || value < I64_MIN || value > I64_MAX) {
      throw new Error('E_ACTOR: mail must be a signed 64-bit value');
    }
    if (actor.sent >= MAX_MAILBOX) {
      throw new Error('E_MAILBOX_FULL: actor ' + label(actor) +
        ' already has ' + MAX_MAILBOX + ' messages');
    }
    actor.mailbox.push(value);
    actor.sent++;
  }

  function checkMemory(actor) {
    if (!actor.memory) return;
    const buffer = actor.memory.buffer;
    if (typeof SharedArrayBuffer !== 'undefined' && buffer instanceof SharedArrayBuffer) {
      throw new Error('E_ACTOR_MEMORY: shared memory is prohibited');
    }
    // Post-turn detection only. Hard ceilings require compiler-emitted Wasm
    // memory maximums; JS cannot retroactively cap module-defined memories.
    if (buffer.byteLength > MAX_ACTOR_MEMORY_BYTES) {
      throw new Error('E_ACTOR_MEMORY: private memory budget exceeded');
    }
  }

  function prepare(actor) {
    // Without host actor capabilities, nested actor spawn/send is denied.
    const { imports, bind } = guestImports(module, out);
    const instance = new WebAssembly.Instance(module, imports);
    bind(instance);
    actor.instance = instance;
    actor.memory = instance.exports.memory ?? null;
    if (typeof instance.exports.actor_init !== 'function' ||
        typeof instance.exports.actor_receive !== 'function') {
      throw new Error('E_ACTOR_ABI: actor exports missing');
    }
    if (actor.memory !== null && !(actor.memory instanceof WebAssembly.Memory)) {
      throw new Error('E_ACTOR_MEMORY: invalid memory export');
    }
    checkMemory(actor);
    instance.exports.actor_init(actor.type);
    checkMemory(actor);
  }

  function close() {
    closed = true;
    for (const actor of actors) {
      actor.mailbox.length = 0;
      actor.instance = null;
      actor.memory = null;
    }
  }

  function drain() {
    if (drainPromise) return drainPromise;
    if (closed) return Promise.resolve('E_ACTOR: actor host closed');
    draining = true;
    drainPromise = (async () => {
      let active = null;
      try {
        // Defer init until main completes: main's output precedes actor output.
        for (const actor of actors) {
          active = actor;
          prepare(actor);
        }
        let remaining = actors.reduce((n, a) => n + a.sent, 0);
        let turns = 0;
        while (remaining > 0) {
          for (const actor of actors) {
            if (actor.done >= actor.sent) continue;
            if (closed) throw new Error('E_ACTOR: tenant carrier closed');
            active = actor;
            const value = actor.mailbox[actor.done];
            actor.instance.exports.actor_receive(actor.type, value, BigInt(actor.done));
            checkMemory(actor);
            actor.done++;
            remaining--;
            // Yield host event loop without implying preemption within a turn.
            if (++turns % BATCH === 0) await yieldTurn();
          }
        }
        return null;
      } catch (error) {
        const reason = active?.instance ? describePanic(active.instance, error) :
          (typeof error?.message === 'string' && /^E_[A-Z_]+: /.test(error.message)
            ? error.message : 'E_RUNTIME: ' + error.message);
        return active ? reason + ' in actor ' + label(active) : reason;
      }
    })();
    return drainPromise;
  }

  return { spawn, send, drain, close, get count() { return actors.length; } };
}
