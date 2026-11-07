/* Guest has zero imports. Run in a fresh worker; parent enforces deadline. */
self.onmessage = async ({ data }) => {
  try {
    const wasm = new Uint8Array(data.wasm);
    if (wasm.byteLength > 65536 || !WebAssembly.validate(wasm)) throw new Error('Invalid/oversized guest module');
    const module = await WebAssembly.compile(wasm);
    if (WebAssembly.Module.imports(module).length !== 0) throw new Error('Guest imports are disabled');
    const exports = WebAssembly.Module.exports(module);
    if (exports.length !== 1 || exports[0].name !== 'main' || exports[0].kind !== 'function') {
      throw new Error('Guest export contract mismatch');
    }
    const instance = await WebAssembly.instantiate(module, {});
    const result = instance.exports.main();
    if (!Number.isInteger(result)) throw new Error('Guest returned unexpected value');
    self.postMessage({ ok: true, value: result });
  } catch (error) {
    self.postMessage({ ok: false, message: `E_RUNTIME: ${error.message}` });
  }
};
