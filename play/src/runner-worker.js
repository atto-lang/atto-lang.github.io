/* One disposable program worker owns guest main() and the lifetime of every
 * actor it spawns. Each actor gets its own nested Web Worker + Wasm instance.
 * A successful response is sent only after accepted actor messages were
 * delivered and each child acknowledged terminal close. */
import { describePanic, guestImports, appendCapped, integratedActorExports } from './guest.js';
import { ActorSession, ActorScope, ACTOR_ADMISSION } from './actor-lifecycle.js';

const MAX_ACTORS = 4;
let started = false;
let activeScope = null;
self.onmessage = async ({ data }) => {
  if (data?.kind === 'cancel') {
    // Cooperative cancellation while the parent is suspended on child I/O.
    // The UI also terminates the parent Worker to interrupt synchronous loops.
    activeScope?.cancel_all();
    return;
  }
  // One disposable parent runner owns only one actor namespace and program.
  if (started) {
    self.postMessage({ok:false, message:'E_RUNNER_REUSED', stdout:'', truncated:false});
    return;
  }
  started = true;
  const out = { text: '', truncated: false };
  const scope = new ActorScope({max_actors:MAX_ACTORS});
  activeScope=scope;
  const actors = scope.actors;
  const joined = new Set();
  let instance = null;
  try {
    const wasm = new Uint8Array(data.wasm);
    if (wasm.byteLength > 1 << 20 || !WebAssembly.validate(wasm)) {
      throw new Error('Invalid/oversized guest module');
    }
    const module = await WebAssembly.compile(wasm);
    if(scope.cancelled)throw new Error('E_RUN_CANCELLED');
    const receiverExports = integratedActorExports(module);
    const actorCapabilities = {
      actor_spawn: id => {
        if (!Number.isInteger(id) || id < 0 || id > 1024 ||
            actors.length >= MAX_ACTORS || scope.closed ||
            !receiverExports.has('atto_actor_receive_' + id)) {
          throw new Error('E_ACTOR_LIMIT_OR_ID');
        }
        const child = new Worker(new URL('./actor-guest-worker.js', import.meta.url), { type: 'module' });
        const actor = new ActorSession(child, id, wasm, { timeout_ms: 2000 });
        return scope.add(actor);
      },
      actor_send: (handle, value) => {
        if (!Number.isInteger(handle) || handle < 1 || handle > actors.length) {
          return ACTOR_ADMISSION.INVALID;
        }
        return actors[handle - 1].admit(value);
      },
      actor_join: handle => {
        if (!Number.isInteger(handle) || handle < 1 || handle > actors.length) {
          throw new Error('E_ACTOR_HANDLE');
        }
        if (joined.has(handle)) throw new Error('E_ACTOR_DUP_JOIN');
        joined.add(handle);
        // The compiler admits this only as a terminal source-level await.
        // Wasm returns synchronously; the host awaits verified completion.
      },
    };
    const { imports, bind } = guestImports(module, out, actorCapabilities);
    instance = await WebAssembly.instantiate(module, imports);
    bind(instance);
    const value = instance.exports.main();
    if (typeof value !== 'bigint') throw new Error('Guest returned unexpected value');
    const { completed, replies } = await scope.drain_all();
    // Child execution overlaps, but all visible stdout is flushed in
    // actor-spawn and per-actor FIFO order after verified terminal ACKs.
    for(let i=0;i<replies.length;i++)
      for(const [message,reply] of replies[i])
        appendCapped(out,'actor['+(i+1)+'] receive('+message+') -> '+reply+'\n');
    for (const handle of joined) {
      if (completed[handle - 1]?.kind !== 'completed') {
        throw new Error('E_ACTOR_DONE_PROTOCOL');
      }
    }
    self.postMessage({ ok: true, value: value.toString(), stdout: out.text, truncated: out.truncated });
  } catch (error) {
    const message = instance ? describePanic(instance, error) : 'E_RUNTIME: ' + error.message;
    self.postMessage({ ok: false, message, stdout: out.text, truncated: out.truncated });
  } finally {
    scope.cancel_all();
    if(activeScope===scope)activeScope=null;
  }
};
