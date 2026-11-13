/** Strict Wasm32 memory admission for guest ABI v2.
 * WebAssembly.Module.exports does not reveal declared memory maxima. Inspect
 * the actual binary BEFORE any guest Wasm instance is constructed, rather
 * than checking the live buffer only after a potentially huge allocation.
 * Import admission is performed separately by guestImports().
 */
export const MAX_GUEST_MEMORY_PAGES = 16; // 1 MiB
const WASM_MAGIC_VERSION = [0, 97, 115, 109, 1, 0, 0, 0];

export function admitWasm32Memory(bytes, { maxPages = MAX_GUEST_MEMORY_PAGES } = {}) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 8 ||
      !WASM_MAGIC_VERSION.every((value, index) => bytes[index] === value)) {
    throw new Error('E_ACTOR_MEMORY: invalid core Wasm header');
  }
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 65536) {
    throw new RangeError('E_ACTOR_MEMORY: invalid memory page quota');
  }
  let pos = 8, memorySeen = false, declaredMemories = 0;
  const u32 = (end) => {
    let value = 0;
    for (let i = 0; i < 5; i++) {
      if (pos >= end) throw new Error('E_ACTOR_MEMORY: truncated LEB32');
      const byte = bytes[pos++];
      const payload = byte & 0x7f;
      if (i === 4 && payload > 15) throw new Error('E_ACTOR_MEMORY: LEB32 overflow');
      value += payload * 2 ** (i * 7);
      if (!(byte & 0x80)) return value;
    }
    throw new Error('E_ACTOR_MEMORY: malformed LEB32');
  };
  while (pos < bytes.length) {
    const id = bytes[pos++];
    const length = u32(bytes.length);
    const end = pos + length;
    if (!Number.isSafeInteger(end) || end > bytes.length) {
      throw new Error('E_ACTOR_MEMORY: malformed Wasm section bounds');
    }
    if (id === 5) {
      if (memorySeen) throw new Error('E_ACTOR_MEMORY: duplicate memory section');
      memorySeen = true;
      const count = u32(end);
      declaredMemories = count;
      if (count > 1) throw new Error('E_ACTOR_MEMORY: multi-memory guest not admitted');
      for (let i = 0; i < count; i++) {
        // 0x01: bounded, unshared 32-bit memory. Fail closed on memory64,
        // shared memory, and declarations missing a maximum.
        const flags = u32(end);
        if (flags !== 1) {
          throw new Error('E_ACTOR_MEMORY: bounded private Wasm32 memory required');
        }
        const minimum = u32(end);
        const maximum = u32(end);
        if (minimum > maximum || maximum > maxPages) {
          throw new Error(`E_ACTOR_MEMORY: declared memory exceeds ${maxPages} pages`);
        }
      }
      if (pos !== end) throw new Error('E_ACTOR_MEMORY: invalid memory section tail');
    }
    pos = end;
  }
  return { memoryCount: declaredMemories, maxPages };
}
