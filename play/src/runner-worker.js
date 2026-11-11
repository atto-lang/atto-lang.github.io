/* Disposable atto.browser.guest.v2 program runner.
 * Actual actor Worker objects remain owned independently by the page broker.
 * Main receives only a scoped MessagePort, preserving v2 actor ABI.
 */
import { actorNames, describePanic, guestImports } from './guest.js';
import { createActorHost } from './actor-host.js';
import { actorWorkerPortFactory } from './actor-worker-port.js';

let started = false;
self.onmessage = async ({ data }) => {
  if (started) {
    self.postMessage({ok:false, message:'E_RUNNER_REUSED', stdout:'', truncated:false, actors:0});
    return;
  }
  started = true;
  const out = { text: '', truncated: false };
  let host = null;
  const actorPort = data?.actorPort;
  const reply = message => self.postMessage({
    ...message, stdout: out.text, truncated: out.truncated, actors: host?.count ?? 0
  });
  try {
    if (actorPort !== undefined &&
        (!(actorPort instanceof MessagePort) || typeof actorPort.postMessage !== 'function'))
      throw new Error('E_ACTOR_PORT');
    const wasm = new Uint8Array(data.wasm);
    if (wasm.byteLength > 1 << 20 || !WebAssembly.validate(wasm))
      throw new Error('Invalid/oversized guest module');
    const module = await WebAssembly.compile(wasm);
    const names = actorNames(module);
    if (names.length) host = createActorHost({
      wasm, names, out,
      ...(actorPort ? { WorkerImpl: actorWorkerPortFactory(actorPort) } : {})
    });
    const { imports, bind } = guestImports(module, out, host);
    const instance = await WebAssembly.instantiate(module, imports);
    bind(instance);
    let result;
    try { result = instance.exports.main(); }
    catch (error) {
      reply({ ok: false, message: describePanic(instance, error) });
      return;
    }
    if (typeof result !== 'bigint') throw new Error('Guest returned unexpected value');
    const fault = host ? await host.drain() : null;
    if (fault) reply({ ok: false, message: fault, value: result.toString() });
    else reply({ ok: true, value: result.toString() });
  } catch (error) {
    reply({ ok: false, message: 'E_RUNTIME: ' + error.message });
  } finally {
    try { host?.close(); } catch {}
    try { actorPort?.close(); } catch {}
  }
};
