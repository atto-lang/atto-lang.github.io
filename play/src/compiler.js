/** Browser bridge for compiler ABI v2 (atto-source.rs). No JS source evaluator or transpiler. */
export const COMPILER_ABI = 2;
const MAX_GUEST_BYTES = 1 << 20;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

function errorString(memory, address) {
  const bytes = new Uint8Array(memory.buffer);
  let end = address;
  while (end < bytes.length && end < address + 512 && bytes[end]) end++;
  return decoder.decode(bytes.subarray(address, end));
}

export async function createCompiler(compilerBytes) {
  if (!WebAssembly.validate(compilerBytes)) throw new Error('Compiler is not valid WebAssembly');
  const { instance } = await WebAssembly.instantiate(compilerBytes, {});
  const api = instance.exports;
  if (!api.memory || typeof api.compile !== 'function' || typeof api.abi_version !== 'function' || api.abi_version() !== COMPILER_ABI) {
    throw new Error('Compiler ABI mismatch');
  }
  const capacity = api.input_capacity();
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 65536) throw new Error('Invalid compiler source capacity');
  return {
    compile(source) {
      if (typeof source !== 'string') throw new TypeError('source must be a string');
      const bytes = encoder.encode(source);
      if (bytes.length > capacity) {
        return { ok: false, diagnostics: [{ line: 1, column: 1, message: `E_SOURCE_LIMIT: source exceeds ${capacity} UTF-8 bytes` }] };
      }
      const pointer = api.input_ptr();
      if (pointer < 0 || pointer + bytes.length >= api.memory.buffer.byteLength) throw new Error('Compiler input memory bounds violated');
      new Uint8Array(api.memory.buffer, pointer, bytes.length).set(bytes);
      const status = api.compile(bytes.length);
      if (status !== 0) {
        const diagnostic = {
          line: api.error_line_number(),
          column: api.error_column_number(),
          message: errorString(api.memory, api.error_ptr()) || 'E_COMPILER: unspecified compilation error'
        };
        if (api.result_length() !== 0) throw new Error('Compiler published artifact on error');
        return { ok: false, diagnostics: [diagnostic] };
      }
      const length = api.result_length();
      const outPtr = api.result_ptr();
      if (length < 8 || length > MAX_GUEST_BYTES || outPtr < 0 || outPtr + length > api.memory.buffer.byteLength) {
        throw new Error('Compiler output memory bounds violated');
      }
      const wasm = new Uint8Array(api.memory.buffer, outPtr, length).slice();
      if (!WebAssembly.validate(wasm)) throw new Error('Compiler emitted invalid WebAssembly');
      return { ok: true, wasm, diagnostics: [] };
    }
  };
}