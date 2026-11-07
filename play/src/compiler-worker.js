import { createCompiler } from './compiler.js';
let compilerPromise;
self.onmessage = async ({ data }) => {
  try {
    if (!compilerPromise) {
      compilerPromise = fetch(new URL('../public/atto_compiler.wasm', import.meta.url), { cache: 'force-cache' })
        .then(async response => {
          if (!response.ok) throw new Error(`Compiler download failed (${response.status})`);
          return createCompiler(await response.arrayBuffer());
        });
    }
    const compiler = await compilerPromise;
    const compiled = compiler.compile(data.source);
    if (compiled.ok) {
      self.postMessage({ ok: true, wasm: compiled.wasm }, [compiled.wasm.buffer]);
    } else {
      self.postMessage({ ok: false, diagnostics: compiled.diagnostics });
    }
  } catch (error) {
    self.postMessage({ ok: false, diagnostics: [{ line: 1, column: 1, message: `E_HOST: ${error.message}` }] });
  }
};
