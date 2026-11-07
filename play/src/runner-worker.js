/* One disposable program worker owns guest main() and the lifetime of every
 * actor it spawns. Each actor gets its own nested Web Worker + Wasm instance.
 * A successful response is sent only after accepted actor messages were
 * delivered and each child acknowledged terminal close. */
import { describePanic, guestImports, appendCapped } from './guest.js';
import { ActorSession, ACTOR_ADMISSION } from './actor-lifecycle.js';

const MAX_ACTORS = 4;
self.onmessage = async ({ data }) => {
  const out = { text: '', truncated: false };
  const actors = [];
  const joined = new Set();
  let instance = null;
  try {
    const wasm = new Uint8Array(data.wasm);
    if (wasm.byteLength > 1 << 20 || !WebAssembly.validate(wasm)) {
      throw new Error('Invalid/oversized guest module');
    }
    const module = await WebAssembly.compile(wasm);
    const receiverExports = new Set(
      WebAssembly.Module.exports(module).filter(x => x.kind === 'function' &&
        /^atto_actor_receive_[0-9]+$/.test(x.name)).map(x => x.name)
    );
    const actorCapabilities = {
      actor_spawn: id => {
        if (!Number.isInteger(id) || id < 0 || id > 1024 ||
            actors.length >= MAX_ACTORS ||
            !receiverExports.has('atto_actor_receive_' + id)) {
          throw new Error('E_ACTOR_LIMIT_OR_ID');
        }
        const child = new Worker(new URL('./actor-guest-worker.js', import.meta.url), { type: 'module' });
        const actor = new ActorSession(child, id, wasm, { timeout_ms: 2000 });
        actors.push(actor);
        return actors.length;
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
    for (let i = 0; i < actors.length; i++) {
      const actor = actors[i];
      const done = await actor.drain_and_close((message, reply) =>
        appendCapped(out, 'actor[' + (i + 1) + '] receive(' + message + ') -> ' + reply + '\n')
      );
      if (done.kind !== 'completed' || done.actor_id !== actor.actor_id) {
        throw new Error('E_ACTOR_DONE_PROTOCOL');
      }
    }
    for (const handle of joined) {
      if ((await actors[handle - 1].get_done()).kind !== 'completed') {
        throw new Error('E_ACTOR_DONE_PROTOCOL');
      }
    }
    self.postMessage({ ok: true, value: value.toString(), stdout: out.text, truncated: out.truncated });
  } catch (error) {
    const message = instance ? describePanic(instance, error) : 'E_RUNTIME: ' + error.message;
    self.postMessage({ ok: false, message, stdout: out.text, truncated: out.truncated });
  } finally {
    for (const actor of actors) if (!actor.is_terminal()) actor.cancel();
  }
};
