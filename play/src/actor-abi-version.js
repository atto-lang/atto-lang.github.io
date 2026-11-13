/** Fail-closed selection of the versioned Atto guest actor ABI.
 *
 * Current pinned browser guests predate this marker and are ABI v2.
 * The draft v3 contract declares the exact bytes [0x03, 0x00] in
 * WebAssembly custom section "atto.actor.abi". A v3 module must never be
 * interpreted as a v2 guest merely because it also exports "main".
 *
 * This code does NOT implement actor_resume, fuel metering or continuations.
 */
export const ACTOR_ABI_SECTION = 'atto.actor.abi';
export const ACTOR_ABI_V2 = 2;
export const ACTOR_ABI_V3 = 3;

export function detectActorAbi(module) {
  if (!(module instanceof WebAssembly.Module)) {
    throw new TypeError('E_GUEST_ABI: a compiled Wasm module is required');
  }
  const sections = WebAssembly.Module.customSections(module, ACTOR_ABI_SECTION);
  if (sections.length === 0) return ACTOR_ABI_V2; // pinned legacy guest
  if (sections.length !== 1) {
    throw new Error('E_GUEST_ABI: duplicate actor ABI markers');
  }
  const bytes = new Uint8Array(sections[0]);
  if (bytes.byteLength !== 2 || bytes[1] !== 0) {
    throw new Error('E_GUEST_ABI: malformed actor ABI marker');
  }
  if (bytes[0] === ACTOR_ABI_V2) return ACTOR_ABI_V2;
  if (bytes[0] === ACTOR_ABI_V3) return ACTOR_ABI_V3;
  throw new Error('E_GUEST_ABI: unsupported actor ABI marker');
}

export function requireGuestAbiV2(module) {
  const version = detectActorAbi(module);
  if (version !== ACTOR_ABI_V2) {
    throw new Error('E_GUEST_ABI_UNSUPPORTED: actor_resume v3 is not implemented in this tenant host');
  }
  return version;
}
