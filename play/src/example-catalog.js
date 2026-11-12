/** The pinned browser compiler is authoritative: previews are readable source,
 * not claims that the current Wasm frontend can execute these constructs.
 * Deliberately no JavaScript interpreter or automatic source rewriting. */
export const EXECUTABLE_EXAMPLES = Object.freeze(["hello","fib","primes","conditions","overflow","error","classes","actors","enums"]);
export const PREVIEW_EXAMPLES = Object.freeze(["trap","result-option","channel-bounded","channel-probe","channel-unbounded","rx-observable","rx-interop"]);
export const EXAMPLES = Object.freeze([...EXECUTABLE_EXAMPLES, ...PREVIEW_EXAMPLES]);
export function isPreviewExample(id) { return PREVIEW_EXAMPLES.includes(id); }
