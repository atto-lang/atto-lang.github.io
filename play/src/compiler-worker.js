import { createCompiler, verifyCompilerBytes } from './compiler.js';
import { COMPILER_SHA256, COMPILER_BYTES } from './compiler-pin.js';
// The URL carries the pinned digest, so an HTTP-cached copy of an older
// compiler is never reused after a redeploy; the bytes are verified anyway.
const COMPILER_URL = new URL(`../public/atto_compiler.wasm?sha256=${COMPILER_SHA256.slice(0, 16)}`, import.meta.url);
let compilerPromise;
self.onmessage = async ({ data }) => {
  try {
    if (!compilerPromise) {
      compilerPromise = fetch(COMPILER_URL, { cache: 'force-cache', credentials: 'omit' })
        .then(async response => {
          if (!response.ok) throw new Error(`Compiler download failed (${response.status})`);
          const bytes = new Uint8Array(await response.arrayBuffer());
          await verifyCompilerBytes(bytes, COMPILER_SHA256, COMPILER_BYTES);
          return createCompiler(bytes);
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
