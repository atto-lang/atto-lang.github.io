/** Tenant-local actor scheduler for guest ABI atto.browser.guest.v2.
 *
 * Runs inside the existing disposable runner Worker. Every actor gets an
 * independent WebAssembly.Instance of the SAME compiled module, including
 * its own linear memory (when the guest declares one) and mutable globals.
 * No actor Web Workers or raw cross-actor pointers are created.
 *
 * This is intentionally a synchronous-mail ABI: only main() can spawn/send,
 * and receive() executes to completion before the next actor is scheduled.
 * There is NO preemption inside a guest call yet. The outer runner deadline
 * must terminate the tenant worker if a guest loops forever.
 */
import { appendCapped, describePanic, guestImports } from './guest.js';
import { MAX_ACTORS, MAX_MAILBOX } from './actor-host.js';

const I64_MIN = -(1n << 63n);
const I64_MAX = (1n << 63n) - 1n;
const MAX_MEMORY_BYTES = 1 << 20;
const YIELD_EVERY = 64;

export function createTenantActorHost({ module, names, out }) {
  if (!(module instanceof WebAssembly.Module)) throw new TypeError('compiled Wasm module required');
  if (!Array.isArray(names) || !names.length) throw new Error('actor table required');
  if (!out || typeof out.text !== 'string') throw new TypeError('stdout accumulator required');

  const actors = [];
  let fault = null;
  let closed = false;
  let draining = false;

  function label(a) { return `${a.name}#${a.ref}`; }
  function flush(a) {
    if (a.output.text) appendCapped(out, a.output.text);
    if (a.output.truncated) out.truncated = true;
    a.output.text = '';
    a.output.truncated = false;
  }
  function failed(a, error) {
    if (!fault) {
      const description = a.instance
        ? describePanic(a.instance, error)
        : /^E_[A-Z_]+: /.test(error?.message ?? '') ? error.message : `E_ACTOR: ${error?.message ?? 'unknown failure'}`;
      fault = `${description} in actor ${label(a)}`;
    }
    a.failed = true;
    flush(a);
  }
  function checkMemory(a) {
    const memory = a.instance?.exports.memory;
    // Older pinned scalar-only actor artifacts export no memory. They have
    // private instance globals but no guest linear heap. New compiler builds
    // export a private bounded memory for every actor-bearing module.
    if (memory !== undefined && (!(memory instanceof WebAssembly.Memory) ||
        memory.buffer.byteLength > MAX_MEMORY_BYTES)) {
      throw new Error('E_ACTOR_MEMORY: actor linear memory exceeds 1 MiB');
    }
  }

  function spawn(type) {
    if (closed) throw new Error('E_ACTOR: tenant closed');
    if (!Number.isInteger(type) || type < 0 || type >= names.length) throw new Error('E_ACTOR: unknown actor type');
    if (actors.length >= MAX_ACTORS) throw new Error(`E_ACTOR_LIMIT: at most ${MAX_ACTORS} actors per run`);

    const a = {
      ref: actors.length, type, name: names[type], instance: null,
      output: { text: '', truncated: false }, mailbox: [], head: 0,
      sent: 0, failed: false
    };
    actors.push(a);
    try {
      const host = guestImports(module, a.output);
      a.instance = new WebAssembly.Instance(module, host.imports);
      host.bind(a.instance);
      if (typeof a.instance.exports.actor_init !== 'function' ||
          typeof a.instance.exports.actor_receive !== 'function') {
        throw new Error('E_ACTOR_PROTOCOL: actor exports missing');
      }
      checkMemory(a);
      a.instance.exports.actor_init(type);
      checkMemory(a);
      flush(a);
    } catch (error) {
      failed(a, error);
    }
    return a.ref;
  }

  function send(ref, value) {
    if (closed) throw new Error('E_ACTOR: tenant closed');
    const a = Number.isInteger(ref) ? actors[ref] : undefined;
    if (!a) throw new Error('E_ACTOR: invalid actor reference');
    if (typeof value !== 'bigint' || value < I64_MIN || value > I64_MAX) {
      throw new Error('E_ACTOR: mail must be a signed 64-bit value');
    }
    if (a.sent >= MAX_MAILBOX) {
      throw new Error(`E_MAILBOX_FULL: actor ${label(a)} already has ${MAX_MAILBOX} messages`);
    }
    a.mailbox.push({ value, sequence: a.sent });
    a.sent++;
  }

  /** Round-robin, one mailbox entry per actor per sweep. This yields the JS
   * event loop between bounded groups of completed guest calls, never within
   * a guest Wasm invocation. Actor-to-actor sends are denied by guestImports.
   */
  async function drain() {
    if (closed) throw new Error('E_ACTOR: tenant closed');
    if (draining) throw new Error('E_ACTOR_PROTOCOL: concurrent drains');
    draining = true;
    let steps = 0;
    try {
      while (true) {
        let progressed = false;
        for (const a of actors) {
          // A recoverable actor trap marks only that actor failed; healthy
          // siblings still drain before the tenant reports the first fault.
          if (a.failed || a.head >= a.mailbox.length) continue;
          progressed = true;
          const { value, sequence } = a.mailbox[a.head++];
          try {
            a.instance.exports.actor_receive(a.type, value, BigInt(sequence));
            checkMemory(a);
            flush(a);
          } catch (error) {
            failed(a, error);
            continue;
          }
          if (++steps % YIELD_EVERY === 0) {
            await new Promise(resolve => setTimeout(resolve, 0));
            if (closed) return 'E_ACTOR: tenant closed';
          }
        }
        if (!progressed) break;
      }
      return fault;
    } finally {
      draining = false;
    }
  }

  function close() {
    closed = true;
    for (const a of actors) {
      a.mailbox.length = 0;
      a.instance = null;
      a.output.text = '';
    }
  }

  return {
    spawn, send, drain, close,
    get count() { return actors.length; },
    get memoryBytes() {
      return actors.reduce((sum, a) => sum + (a.instance?.exports.memory?.buffer.byteLength ?? 0), 0);
    }
  };
}
