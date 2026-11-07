/* Executes one guest module (contract atto.browser.guest.v1) in a fresh,
 * disposable worker. The parent enforces the wall-clock deadline by
 * terminating this worker. The only capabilities granted are the atto.print_*
 * output functions; stdout is capped. */
import { describePanic, guestImports } from './guest.js';

self.onmessage = async ({ data }) => {
  const out = { text: '', truncated: false };
  try {
    const wasm = new Uint8Array(data.wasm);
    if (wasm.byteLength > 1 << 20 || !WebAssembly.validate(wasm)) throw new Error('Invalid/oversized guest module');
    const module = await WebAssembly.compile(wasm);
    const { imports, bind } = guestImports(module, out);
    const instance = await WebAssembly.instantiate(module, imports);
    bind(instance);
    let result;
    try {
      result = instance.exports.main();
    } catch (error) {
      self.postMessage({ ok: false, message: describePanic(instance, error), stdout: out.text, truncated: out.truncated });
      return;
    }
    if (typeof result !== 'bigint') throw new Error('Guest returned unexpected value');
    self.postMessage({ ok: true, value: result.toString(), stdout: out.text, truncated: out.truncated });
  } catch (error) {
    self.postMessage({ ok: false, message: `E_RUNTIME: ${error.message}`, stdout: out.text, truncated: out.truncated });
  }
};
