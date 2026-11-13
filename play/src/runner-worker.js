/* Executes one guest module (contract atto.browser.guest.v2) in a fresh,
 * disposable worker. The parent enforces the wall-clock deadline by
 * terminating this worker, including all tenant-local actor instances.
 * The only capabilities granted are the atto.print_* output functions and,
 * for programs with actors, spawn/send through the bounded actor host. */
import { actorNames, describePanic, guestImports } from './guest.js';
import { createTenantActorHost } from './tenant-actor-host.js';

self.onmessage = async ({ data }) => {
  const out = { text: '', truncated: false };
  let host = null;
  const reply = message => self.postMessage({ ...message, stdout: out.text, truncated: out.truncated, actors: host?.count ?? 0 });
  try {
    const wasm = new Uint8Array(data.wasm);
    if (wasm.byteLength > 1 << 20 || !WebAssembly.validate(wasm)) throw new Error('Invalid/oversized guest module');
    const module = await WebAssembly.compile(wasm);
    const names = actorNames(module);
    if (names.length) host = createTenantActorHost({ module, names, out });
    const { imports, bind } = guestImports(module, out, host);
    const instance = await WebAssembly.instantiate(module, imports);
    bind(instance);
    let result;
    try {
      result = instance.exports.main();
    } catch (error) {
      host?.close();
      reply({ ok: false, message: describePanic(instance, error) });
      return;
    }
    if (typeof result !== 'bigint') throw new Error('Guest returned unexpected value');
    // main has returned: wait until every actor has handled all of its mail
    const fault = host ? await host.drain() : null;
    host?.close();
    if (fault) reply({ ok: false, message: fault, value: result.toString() });
    else reply({ ok: true, value: result.toString() });
  } catch (error) {
    host?.close();
    reply({ ok: false, message: `E_RUNTIME: ${error.message}` });
  }
};
