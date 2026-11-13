/* One disposable tenant Worker per guest run; actors are private instances of
 * a compiled Wasm module scheduled serially here, not nested actor workers. */
import { actorNames, describePanic, guestImports } from './guest.js';
import { createActorHost } from './actor-host.js';

self.onmessage = async ({ data }) => {
  const out = { text: '', truncated: false };
  let host = null;
  const reply = message => self.postMessage({ ...message, stdout: out.text, truncated: out.truncated, actors: host?.count ?? 0 });
  try {
    const wasm = new Uint8Array(data.wasm);
    if (wasm.byteLength > 1 << 20 || !WebAssembly.validate(wasm)) throw new Error('Invalid/oversized guest module');
    const module = await WebAssembly.compile(wasm);
    const names = actorNames(module);
    if (names.length) host = createActorHost({ module, names, out });
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
    const fault = host ? await host.drain() : null;
    reply(fault ? { ok: false, message: fault, value: result.toString() }
      : { ok: true, value: result.toString() });
    host?.close();
  } catch (error) {
    reply({ ok: false, message: 'E_RUNTIME: ' + error.message });
    host?.close();
  }
};
