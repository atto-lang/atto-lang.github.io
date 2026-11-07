/** Minimal bounded formatter ABI driver; no backend, WASI or JS eval. */
export const FORMATTER_MAX_SOURCE = 65536;
export const FORMATTER_MAX_OUTPUT = 262144;
const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', {fatal:true});
export function formatWithWasm(instance, source) {
  if (typeof source !== 'string') throw new TypeError('Formatter source must be text');
  const input = encoder.encode(source);
  if (!input.length || input.length > FORMATTER_MAX_SOURCE) {
    throw new Error('Formatter requires 1–65536 UTF-8 source bytes');
  }
  const {memory, oresfmt_alloc:alloc, oresfmt_free:free, oresfmt_format:format} = instance?.exports || {};
  if (!(memory instanceof WebAssembly.Memory) ||
      typeof alloc !== 'function' || typeof free !== 'function' || typeof format !== 'function')
    throw new Error('Formatter Wasm ABI mismatch');
  const capacity = Math.min(FORMATTER_MAX_OUTPUT, Math.max(4096, input.length * 4 + 4096));
  let inputPtr = 0, outputPtr = 0;
  try {
    inputPtr = alloc(input.length);
    outputPtr = alloc(capacity);
    if (!inputPtr || !outputPtr) throw new Error('Formatter could not allocate memory');
    // Allocation may grow memory; read the buffer only after both calls.
    new Uint8Array(memory.buffer, inputPtr, input.length).set(input);
    const status = format(inputPtr, input.length, outputPtr, capacity);
    if (!Number.isInteger(status) || status === -2147483648) throw new Error('Formatter rejected buffer bounds');
    const n = status < 0 ? -status - 1 : status;
    if (n < 0 || n > capacity) throw new Error('Formatter produced an oversized response');
    const result = decoder.decode(new Uint8Array(memory.buffer, outputPtr, n));
    return status < 0 ? {ok:false,diagnostic:result.slice(0,4096)} : {ok:true,formatted:result};
  } finally {
    if (inputPtr) free(inputPtr,input.length);
    if (outputPtr) free(outputPtr,capacity);
  }
}
export function mapFormatCaret(previous, next, offset) {
  const p=Math.max(0,Math.min(previous.length,Number.isFinite(offset)?Math.trunc(offset):0));
  if (previous===next) return p;
  // Keep unchanged prefixes/suffixes exactly, including selections near EOF.
  let prefix=0;
  while (prefix<Math.min(previous.length,next.length)&&previous[prefix]===next[prefix])prefix++;
  let suffix=0;
  while (suffix<Math.min(previous.length-prefix,next.length-prefix) &&
    previous[previous.length-1-suffix]===next[next.length-1-suffix])suffix++;
  if (p<=prefix) return p;
  if (p>=previous.length-suffix) return next.length-(previous.length-p);
  // Fallback for indentation edits: preserve logical line and visual column.
  const line=previous.slice(0,p).split('\n').length-1;
  const oldLineStart=previous.lastIndexOf('\n',p-1)+1;
  const oldIndent= (previous.slice(oldLineStart).match(/^[ \t]*/)||[''])[0].length;
  const column=Math.max(0,p-oldLineStart-oldIndent);
  let newLineStart=0;
  for(let i=0;i<line;i++){const at=next.indexOf('\n',newLineStart);if(at<0)break;newLineStart=at+1;}
  const rest=next.slice(newLineStart), indent=(rest.match(/^[ \t]*/)||[''])[0].length;
  const lineEnd=next.indexOf('\n',newLineStart);
  return Math.min(lineEnd<0?next.length:lineEnd,newLineStart+indent+column);
}
