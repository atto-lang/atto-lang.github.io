/** Browser guest ABI v2 import admission, adapted from atto-source.rs PR #241.
 * WebAssembly.Module.imports() hides signatures: enforce the actual binary
 * type/import section before constructing any guest instance.
 * This validates signatures; it does not grant additional capabilities.
 */
const SIGNATURES = Object.freeze({
  print_i64: [[0x7e], []],
  print_bool: [[0x7f], []],
  print_str: [[0x7f, 0x7f], []],
  print_newline: [[], []],
  print_f64: [[0x7c], []],
  actor_spawn: [[0x7f], [0x7f]],
  actor_send: [[0x7f, 0x7e], []],
  actor_link: [[0x7f, 0x7f], []],
  actor_emit: [[0x7e], []],
});
const BASE = new Set(['print_i64', 'print_bool', 'print_str', 'print_newline', 'actor_spawn', 'actor_send']);
const decoder = new TextDecoder('utf-8', { fatal: true });
const HEADER = [0, 97, 115, 109, 1, 0, 0, 0];
const reject = message => { throw new Error('E_GUEST_ABI: ' + message); };

export function validateGuestImportABI(bytes, module, { allowFloat = false, allowPipeline = false } = {}) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 8 || bytes.byteLength > 1048576 ||
      HEADER.some((byte, i) => bytes[i] !== byte)) reject('invalid Wasm bytes');
  if (!(module instanceof WebAssembly.Module)) reject('compiled module required');
  const allowed = new Set(BASE);
  if (allowFloat) allowed.add('print_f64');
  if (allowPipeline) { allowed.add('actor_link'); allowed.add('actor_emit'); }
  let pos = 8, types = [], imported = [], seenTypes = false, seenImports = false;
  const byte = end => {
    if (pos >= end) reject('truncated Wasm type/import section');
    return bytes[pos++];
  };
  const u32 = end => {
    let value = 0;
    for (let i = 0; i < 5; i++) {
      const b = byte(end);
      if (i === 4 && (b & 0xf0)) reject('overflowed LEB32');
      value += (b & 127) * 2 ** (7 * i);
      if ((b & 128) === 0) {
        if (i && (b & 127) === 0) reject('noncanonical LEB32');
        return value;
      }
    }
    reject('unterminated LEB32');
  };
  const name = end => {
    const length = u32(end);
    if (length > 128 || length > end - pos) reject('invalid import name length');
    let result;
    try { result = decoder.decode(bytes.subarray(pos, pos + length)); }
    catch { reject('invalid UTF-8 import name'); }
    pos += length;
    return result;
  };
  const valtypes = (end, limit) => {
    const count = u32(end);
    if (count > limit) reject('oversized function signature');
    const types = [];
    for (let i = 0; i < count; i++) {
      const t = byte(end);
      if (![0x7f, 0x7e, 0x7d, 0x7c].includes(t)) reject('unsupported function signature type');
      types.push(t);
    }
    return types;
  };
  while (pos < bytes.length) {
    const id = byte(bytes.length);
    const length = u32(bytes.length);
    if (length > bytes.length - pos) reject('invalid Wasm section bounds');
    const end = pos + length;
    if (id === 1) {
      if (seenTypes || seenImports) reject('duplicate or reordered type section');
      seenTypes = true;
      const count = u32(end);
      if (count > 65536) reject('too many function types');
      for (let i = 0; i < count; i++) {
        if (byte(end) !== 0x60) reject('unsupported function type');
        types.push([valtypes(end, 256), valtypes(end, 16)]);
      }
      if (pos !== end) reject('malformed type section');
    } else if (id === 2) {
      if (seenImports) reject('duplicate import section');
      seenImports = true;
      const count = u32(end);
      if (count > 128) reject('too many imports');
      const names = new Set();
      for (let i = 0; i < count; i++) {
        const namespace = name(end), symbol = name(end), kind = byte(end);
        if (namespace !== 'atto' || !allowed.has(symbol) || !Object.hasOwn(SIGNATURES, symbol)) {
          reject('guest import not granted: ' + namespace + '.' + symbol);
        }
        if (kind !== 0) reject('non-function import: ' + symbol);
        if (names.has(symbol)) reject('duplicate guest import: ' + symbol);
        names.add(symbol);
        const actual = types[u32(end)], expected = SIGNATURES[symbol];
        if (!actual || !actual.every((values, group) =>
          values.length === expected[group].length &&
          values.every((v, j) => v === expected[group][j]))) {
          reject('guest import signature mismatch: ' + symbol);
        }
        imported.push({ module: namespace, name: symbol, kind: 'function' });
      }
      if (pos !== end) reject('malformed import section');
    }
    pos = end;
  }
  const reflection = WebAssembly.Module.imports(module);
  if (reflection.length !== imported.length ||
      imported.some((entry, i) => entry.module !== reflection[i].module ||
        entry.name !== reflection[i].name || entry.kind !== reflection[i].kind)) {
    reject('binary/reflection import mismatch');
  }
  return imported;
}
