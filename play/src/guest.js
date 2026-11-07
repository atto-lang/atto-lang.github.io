/** Host side of guest contract atto.browser.guest.v1 (see docs/COMPILER_CONTRACT.md). */
export const STDOUT_LIMIT = 64 * 1024;
const GRANTED = new Set(['print_i64', 'print_bool', 'print_str', 'print_newline']);
const ALLOWED_EXPORTS = new Set(['main', 'panic_code', 'memory']);

/** Append guest output, capping it at STDOUT_LIMIT UTF-16 units without
 *  ever leaving half of a surrogate pair at the cut. */
export function appendCapped(out, text) {
  if (out.truncated) return;
  const room = STDOUT_LIMIT - out.text.length;
  if (text.length <= room) { out.text += text; return; }
  let cut = Math.max(0, room);
  if (cut > 0 && /[\uD800-\uDBFF]/.test(text[cut - 1])) cut--;
  out.text += text.slice(0, cut);
  out.truncated = true;
}

/** Validate a guest module's interface and build its import object.
 *  `out` collects stdout as `{ text, truncated }`. Call `bind(instance)` after
 *  instantiation so string printing can read guest memory. */
export function guestImports(module, out, actorCapabilities = null) {
  const granted = actorCapabilities ? new Set([...GRANTED, 'actor_spawn', 'actor_send', 'actor_join']) : GRANTED;
  for (const imp of WebAssembly.Module.imports(module)) {
    if (imp.module !== 'atto' || imp.kind !== 'function' || !granted.has(imp.name)) {
      throw new Error(`Guest import not granted: ${imp.module}.${imp.name}`);
    }
  }
  const exports = WebAssembly.Module.exports(module);
  const main = exports.find(e => e.name === 'main');
  if (!main || main.kind !== 'function' || exports.some(e => !ALLOWED_EXPORTS.has(e.name) &&
    !(actorCapabilities && e.kind === 'function' && /^atto_actor_receive_[0-9]+$/.test(e.name)))) {
    throw new Error('Guest export contract mismatch');
  }
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let memory = null;
  const write = text => appendCapped(out, text);

  const atto = {
    print_i64: value => write(String(value)),
    print_bool: value => write(value ? 'true' : 'false'),
    print_str: (ptr, len) => {
      if (!memory || ptr < 0 || len < 0 || ptr + len > memory.buffer.byteLength) throw new Error('print_str out of bounds');
      write(decoder.decode(new Uint8Array(memory.buffer, ptr, len)));
    },
    print_newline: () => write('\n'),
  };
  return { imports: { atto: { ...atto, ...(actorCapabilities ?? {}) } },
    bind: instance => { memory = instance.exports.memory ?? null; } };
}

/** Map a guest trap to a language-level message using the exported panic_code. */
export function describePanic(instance, error) {
  const code = instance.exports.panic_code?.value ?? 0;
  if (code === 1) return 'E_PANIC: integer overflow';
  if (code === 2) return 'E_PANIC: division by zero';
  if (code === 3) return 'E_PANIC: class allocation exhausted';
  if (error instanceof RangeError) return 'E_PANIC: stack exhausted (recursion too deep)';
  return `E_RUNTIME: ${error.message}`;
}
