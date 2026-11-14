/** Small, dependency-free UI helpers. This module has no DOM side effects. */
export function formatDiagnostic(item) {
  const integer = value => Number.isSafeInteger(value) && value > 0 ? value : 1;
  return {
    line: integer(item?.line),
    column: integer(item?.column),
    message: String(item?.message ?? 'E_COMPILER: unknown error').slice(0, 4096)
  };
}

export function sourceOffset(source, line, column) {
  const parts = String(source).split('\n');
  const row = Math.min(Math.max(1, Number.isSafeInteger(line) ? line : 1), parts.length);
  const col = Math.min(Math.max(1, Number.isSafeInteger(column) ? column : 1), parts[row - 1].length + 1);
  let offset = 0;
  for (let i = 0; i < row - 1; i++) offset += parts[i].length + 1;
  return offset + col - 1;
}

export function lineNumbers(source, limit = 2000) {
  const count = Math.min(String(source).split('\n').length, limit);
  let result = '';
  for (let i = 1; i <= count; i++) result += i + '\n';
  return result;
}

export function caretPosition(source, offset) {
  const prefix = String(source).slice(0, Math.max(0, offset));
  const lines = prefix.split('\n');
  return { line: lines.length, column: lines[lines.length - 1].length + 1 };
}

export function formatWasm(bytes) {
  if (!(bytes instanceof Uint8Array)) return 'No compiled artifact yet.';
  const sample = Array.from(bytes.subarray(0, 32), byte => byte.toString(16).padStart(2, '0')).join(' ');
  return 'WebAssembly binary\nSize: ' + bytes.byteLength + ' bytes\n' +
    'Header and first ' + Math.min(bytes.byteLength, 32) + ' bytes:\n' + sample +
    (bytes.byteLength > 32 ? '\n… (preview limited to 32 bytes)' : '');
}

/** Explain a proven compiler capability mismatch; never infer support from source text. */
export function compilerDiagnosticGuidance(item) {
  const { message } = formatDiagnostic(item);
  if (/^E_UNSUPPORTED:\s*top-level\s+['"]?define(?:['"]|\b)/i.test(message)) {
    return 'This deployed compiler does not support top-level define declarations yet. Your code was not executed and no Wasm was generated. Try the Hello, functions example for supported code. Class, enum and actor support requires a separately reviewed compiler release.';
  }
  return null;
}
