/** Tenant-local actor scheduler for the atto.browser.guest.v2 contract.
 *
 * There is ONE execution worker per tenant (runner-worker.js in browsers,
 * node/tenant-worker.mjs in Node). Every actor in that worker receives its own
 * WebAssembly.Instance, private linear memory and globals. Neither actors nor
 * their mutable state cross the tenant boundary. This is cooperative scheduling
 * on one worker thread, not parallel execution within a tenant.
 *
 * The existing browser guest ABI only permits main to spawn/send. Messages
 * are drained after main returns. Rich actor-to-actor scheduling, supervisor
 * control lanes require a later guest ABI. A host-only Node session can keep
 * v2 actors alive across multiple externally admitted mailbox turns.
 */
import { appendCapped, describePanic, guestImports } from './guest.js';

export const MAX_ACTORS = 16;
export const MAX_MAILBOX = 10_000;
const I64_MIN = -(2n ** 63n), I64_MAX = 2n ** 63n - 1n;
const YIELD_EVERY = 32;
// ABI v2 class/string memory is fixed to 1 MiB. This is a post-call
// accounting guard, NOT a substitute for pre-instantiation memory admission.
export const MAX_ACTOR_LINEAR_BYTES = 1 << 20;

export function createActorHost({ module, names, out, persistent = false }) {
  if (!(module instanceof WebAssembly.Module)) throw new TypeError('actor host needs a compiled guest module');
  if (!Array.isArray(names) || !names.length) throw new Error('actor host needs an actor table');
  if (!out || typeof out.text !== 'string' || typeof out.truncated !== 'boolean') throw new TypeError('actor host needs an output sink');
  const actors = [];
  let closed = false, draining = false, initialized = false, admissionClosed = false;

  const label = a => `${a.name}#${a.ref}`;
  function checkActorMemory(a) {
    const memory = a.instance?.exports.memory;
    // Legacy scalar-only v2 modules may not declare linear memory at all.
    if (memory === undefined) return;
    if (!(memory instanceof WebAssembly.Memory) || memory.buffer.byteLength > MAX_ACTOR_LINEAR_BYTES) {
      throw new Error(`E_ACTOR_MEMORY: actor memory exceeds ${MAX_ACTOR_LINEAR_BYTES} bytes`);
    }
  }
  function assertOpen() {
    if (closed) throw new Error('E_ACTOR: actor host closed');
    if (draining || admissionClosed) throw new Error('E_ACTOR: mailbox admission closed after main returned');
  }

  function spawn(type) {
    assertOpen();
    if (!Number.isInteger(type) || type < 0 || type >= names.length) throw new Error('E_ACTOR: unknown actor type');
    if (actors.length >= MAX_ACTORS) throw new Error(`E_ACTOR_LIMIT: at most ${MAX_ACTORS} actors per run`);
    const ref = actors.length;
    actors.push({
      ref, type, name: names[type], mailbox: [], cursor: 0, acknowledged: 0, sent: 0,
      instance: null, failed: false, output: { text: '', truncated: false }
    });
    return ref;
  }

  function admit(ref, value) {
    const a = Number.isInteger(ref) ? actors[ref] : undefined;
    if (!a) throw new Error('E_ACTOR: invalid actor reference');
    if (a.failed) throw new Error('E_ACTOR_DEAD: target actor terminated');
    if (typeof value !== 'bigint' || value < I64_MIN || value > I64_MAX) throw new Error('E_ACTOR: mail must be a signed 64-bit value');
    if (a.mailbox.length - a.cursor >= MAX_MAILBOX) {
      throw new Error(`E_MAILBOX_FULL: actor ${label(a)} already has ${MAX_MAILBOX} messages`);
    }
    if (!Number.isSafeInteger(a.sent + 1)) throw new Error('E_ACTOR_LIMIT: mailbox sequence exhausted');
    a.mailbox.push({ sequence: a.sent++, value });
  }

  function send(ref, value) {
    assertOpen();
    admit(ref, value);
  }

  // Trusted tenant host only: guest actor code never receives this capability.
  // It can address only actors already instantiated by this tenant's main().
  function sendExternal(ref, value) {
    if (!persistent || !initialized || closed) throw new Error('E_ACTOR: persistent tenant not ready');
    if (draining) throw new Error('E_ACTOR: concurrent mailbox admission');
    admit(ref, value);
  }

  // No nested Worker is launched. Instantiation is delayed until main has
  // completed and cannot mutate the actor registry further.
  async function drain() {
    if (closed) throw new Error('E_ACTOR: actor host closed');
    if (draining) throw new Error('E_ACTOR: drain already running');
    draining = true;
    admissionClosed = true;
    let firstFault = null;
    const recordFault = (a, message) => {
      a.failed = true;
      if (firstFault === null) firstFault = `${message} in actor ${label(a)}`;
    };
    try {
    if (!initialized) for (const a of actors) {
      try {
        const { imports, bind } = guestImports(module, a.output);
        a.instance = await WebAssembly.instantiate(module, imports);
        bind(a.instance);
        if (typeof a.instance.exports.actor_init !== 'function' ||
            typeof a.instance.exports.actor_receive !== 'function') {
          throw new Error('E_ACTOR_PROTOCOL: guest actor exports missing');
        }
        checkActorMemory(a);
        a.instance.exports.actor_init(a.type);
        checkActorMemory(a);
      } catch (error) {
        recordFault(a, a.instance ? describePanic(a.instance, error) : `E_RUNTIME: ${error.message}`);
      }
    }

    initialized = true;
    let steps = 0;
    // Each pass handles at most one mail per actor, so one busy actor cannot
    // starve another actor. The tenant worker itself remains terminable by its
    // parent on timeout/cancel (even if guest Wasm has a non-yielding loop).
    while (!closed) {
      let progress = false;
      for (const a of actors) {
        if (closed) break;
        if (a.failed || a.cursor >= a.mailbox.length) continue;
        progress = true;
        const { sequence, value } = a.mailbox[a.cursor];
        if (sequence !== a.acknowledged + a.cursor) {
          recordFault(a, 'E_ACTOR_PROTOCOL: mailbox sequence mismatch');
          continue;
        }
        a.output.text = '';
        a.output.truncated = false;
        try {
          a.instance.exports.actor_receive(a.type, value, BigInt(sequence));
          checkActorMemory(a);
        } catch (error) {
          recordFault(a, describePanic(a.instance, error));
        }
        appendCapped(out, a.output.text);
        if (a.output.truncated) out.truncated = true;
        a.cursor++;
        if (a.failed) continue;
        if (++steps % YIELD_EVERY === 0) {
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      }
      if (!progress) break;
    }
    return closed ? 'E_ACTOR: tenant closed during drain' : firstFault;
    } finally {
      if (persistent) {
        // Drop delivered messages; retain strictly increasing sequence numbers
        // and each actor's private Wasm instance for the next mailbox turn.
        for (const a of actors) {
          // A dead actor's queued mail is rejected rather than retried later.
          if (a.failed) a.cursor = a.mailbox.length;
          if (a.cursor) {
            a.mailbox.splice(0, a.cursor);
            a.acknowledged += a.cursor;
            a.cursor = 0;
          }
        }
        draining = false;
      }
    }
  }

  function close() {
    closed = true;
    for (const a of actors) {
      a.instance = null;
      a.mailbox.length = 0;
    }
  }

  return { spawn, send, sendExternal, drain, close,
    get count() { return actors.length; },
    get memoryBytes() {
      return actors.reduce((sum, a) => sum + (a.instance?.exports.memory?.buffer.byteLength ?? 0), 0);
    }
  };
}
