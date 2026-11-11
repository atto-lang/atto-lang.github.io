/** Actor host for guest contract atto.browser.guest.v2.
 *
 * Every `spawn` starts one dedicated Web Worker running src/actor-worker.js
 * with its own instance of the program's module, so actor state (instance
 * globals) is never shared. `send` posts mail in FIFO order with sequence
 * numbers from 0. The host lives inside the runner worker: terminating the
 * runner (Stop or the run deadline) also ends every actor worker it owns.
 */
import { appendCapped } from './guest.js';

export const MAX_ACTORS = 16;
export const MAX_MAILBOX = 10_000;
const I64_MIN = -(2n ** 63n), I64_MAX = 2n ** 63n - 1n;

export function createActorHost({ wasm, names, out, WorkerImpl = globalThis.Worker,
  workerUrl = new URL('./actor-worker.js', import.meta.url) }) {
  if (!(wasm instanceof Uint8Array)) throw new TypeError('actor host needs the guest bytes');
  if (!Array.isArray(names) || !names.length) throw new Error('actor host needs an actor table');
  const actors = [];
  let fault = null, settle = null, closed = false;

  const label = a => `${a.name}#${a.ref}`;
  function fail(a, message) {
    if (fault) return;
    fault = `${message} in actor ${label(a)}`;
    check();
  }
  function check() {
    if (!settle) return;
    if (fault || actors.every(a => a.done === a.sent)) {
      const resolve = settle;
      settle = null;
      resolve(fault);
    }
  }
  function onMessage(a, data) {
    if (closed || fault) return;
    if (typeof data?.stdout === 'string' && data.stdout) appendCapped(out, data.stdout);
    if (data?.truncated) out.truncated = true;
    if (data?.kind === 'fault') {
      fail(a, typeof data.message === 'string' && /^E_[A-Z_]+: /.test(data.message) ? data.message : 'E_ACTOR: worker fault');
    } else if (data?.kind === 'ready' && !a.ready) {
      a.ready = true;
    } else if (data?.kind === 'done' && a.ready &&
        data.sequence === a.done && a.done < a.sent) {
      a.done++;
      check();
    } else {
      fail(a, 'E_ACTOR_PROTOCOL: unexpected actor worker message');
    }
  }

  function spawn(type) {
    if (closed) throw new Error('E_ACTOR: actor host closed');
    if (!Number.isInteger(type) || type < 0 || type >= names.length) throw new Error('E_ACTOR: unknown actor type');
    if (actors.length >= MAX_ACTORS) throw new Error(`E_ACTOR_LIMIT: at most ${MAX_ACTORS} actors per run`);
    const ref = actors.length;
    const a = { ref, type, name: names[type], sent: 0, done: 0, ready: false, worker: null };
    a.worker = new WorkerImpl(workerUrl, { type: 'module' });
    try {
      a.worker.onmessage = event => onMessage(a, event.data);
      a.worker.onerror = event => { event?.preventDefault?.(); fail(a, 'E_ACTOR: worker failed to load or execute'); };
      a.worker.onmessageerror = () => fail(a, 'E_ACTOR_PROTOCOL: undecodable actor message');
      a.worker.postMessage({ kind: 'init', wasm: new Uint8Array(wasm), type });
      actors.push(a);
    } catch (error) {
      try { a.worker.terminate(); } catch {}
      throw error;
    }
    return ref;
  }

  function send(ref, value) {
    if (closed) throw new Error('E_ACTOR: actor host closed');
    const a = Number.isInteger(ref) ? actors[ref] : undefined;
    if (!a) throw new Error('E_ACTOR: invalid actor reference');
    if (typeof value !== 'bigint' || value < I64_MIN || value > I64_MAX) throw new Error('E_ACTOR: mail must be a signed 64-bit value');
    if (a.sent >= MAX_MAILBOX) throw new Error(`E_MAILBOX_FULL: actor ${label(a)} already has ${MAX_MAILBOX} messages`);
    a.worker.postMessage({ kind: 'mail', value, sequence: a.sent });
    a.sent++;
  }

  /** Resolve with null once every mailbox is drained, or with the first actor
   *  fault message. Mail can arrive only from main, so after main returns the
   *  set of messages is final. */
  function drain() {
    return new Promise(resolve => { settle = resolve; check(); });
  }

  function close() {
    if (closed) return;
    closed = true;
    for (const a of actors) {
      for (const key of ['onmessage', 'onerror', 'onmessageerror']) {
        try { a.worker[key] = null; } catch {}
      }
      try { a.worker.terminate(); } catch {}
    }
  }

  return { spawn, send, drain, close, get count() { return actors.length; } };
}
