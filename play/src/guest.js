/** Host side of guest contract atto.browser.guest.v2 (see docs/COMPILER_CONTRACT.md). */
export const STDOUT_LIMIT = 64 * 1024;
const PRINT = new Set(['print_i64', 'print_bool', 'print_str', 'print_newline', 'print_f64']);
const ACTOR = new Set(['actor_spawn', 'actor_send']);
const ALLOWED_EXPORTS = new Set(['main', 'panic_code', 'memory', 'actor_init', 'actor_receive']);
export const MAX_ACTOR_TYPES = 256;
const ACTOR_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;

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

/** Actor type names from the `atto.actors` custom section (vec(name)), or
 *  [] for a program without actors. Malformed tables are rejected. */
export function actorNames(module) {
  const sections = WebAssembly.Module.customSections(module, 'atto.actors');
  const exports = WebAssembly.Module.exports(module);
  const hasActorExports = exports.some(e => e.name === 'actor_init' || e.name === 'actor_receive');
  if (!sections.length) {
    if (hasActorExports) throw new Error('Guest actor table missing');
    return [];
  }
  if (sections.length !== 1) throw new Error('Guest actor table duplicated');
  const bytes = new Uint8Array(sections[0]);
  let pos = 0;
  const leb = () => {
    let value = 0;
    for (let shift = 0; shift < 35; shift += 7) {
      if (pos >= bytes.length) throw new Error('Guest actor table truncated');
      const b = bytes[pos++];
      value += (b & 127) * 2 ** shift;
      if (!(b & 128)) return value;
    }
    throw new Error('Guest actor table malformed');
  };
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const count = leb();
  if (count < 1 || count > MAX_ACTOR_TYPES) throw new Error('Guest actor table size invalid');
  const names = [];
  for (let i = 0; i < count; i++) {
    const length = leb();
    if (pos + length > bytes.length) throw new Error('Guest actor table truncated');
    const name = decoder.decode(bytes.subarray(pos, pos + length));
    if (!ACTOR_NAME.test(name)) throw new Error('Guest actor name invalid');
    names.push(name);
    pos += length;
  }
  if (pos !== bytes.length) throw new Error('Guest actor table has trailing bytes');
  const fn = name => exports.find(e => e.name === name)?.kind === 'function';
  if (!fn('actor_init') || !fn('actor_receive')) throw new Error('Guest actor exports missing');
  return names;
}

/** Validate a guest module's interface and build its import object.
 *  `out` collects stdout as `{ text, truncated }`. `actors` supplies the
 *  `spawn(type)` / `send(ref, value)` capabilities; without it a guest that
 *  calls them traps. Call `bind(instance)` after instantiation so string
 *  printing can read guest memory. */
export function guestImports(module, out, actors = null) {
  for (const imp of WebAssembly.Module.imports(module)) {
    if (imp.module !== 'atto' || imp.kind !== 'function' || !(PRINT.has(imp.name) || ACTOR.has(imp.name))) {
      throw new Error(`Guest import not granted: ${imp.module}.${imp.name}`);
    }
  }
  const exports = WebAssembly.Module.exports(module);
  const main = exports.find(e => e.name === 'main');
  if (!main || main.kind !== 'function' || exports.some(e => !ALLOWED_EXPORTS.has(e.name))) {
    throw new Error('Guest export contract mismatch');
  }
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let memory = null;
  const write = text => appendCapped(out, text);
  const denied = () => { throw new Error('E_ACTOR: actors cannot spawn or send in this context'); };

  const atto = {
    print_i64: value => write(String(value)),
    print_f64: value => write(String(value)),
    print_bool: value => write(value ? 'true' : 'false'),
    print_str: (ptr, len) => {
      if (!memory || ptr < 0 || len < 0 || ptr + len > memory.buffer.byteLength) throw new Error('print_str out of bounds');
      write(decoder.decode(new Uint8Array(memory.buffer, ptr, len)));
    },
    print_newline: () => write('\n'),
    actor_spawn: actors ? type => actors.spawn(type) : denied,
    actor_send: actors ? (ref, value) => actors.send(ref, value) : denied,
  };
  return { imports: { atto }, bind: instance => { memory = instance.exports.memory ?? null; } };
}

/** Map a guest trap to a language-level message using the exported panic_code. */
export function describePanic(instance, error) {
  const code = instance.exports.panic_code?.value ?? 0;
  if (code === 1) return 'E_PANIC: integer overflow';
  if (code === 2) return 'E_PANIC: division by zero';
  if (code === 3) return 'E_PANIC: object heap exhausted';
  if (error instanceof RangeError) return 'E_PANIC: stack exhausted (recursion too deep)';
  // host capability errors (actor limits) already carry their own code
  if (typeof error?.message === 'string' && /^E_[A-Z_]+: /.test(error.message)) return error.message;
  return `E_RUNTIME: ${error.message}`;
}
