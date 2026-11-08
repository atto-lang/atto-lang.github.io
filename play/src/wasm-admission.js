// Fail-closed, bounded admission for public browser guest Wasm. Validate first,
// then inspect the *validated* section structure before compilation/instantiation.
// Guest memory is independent per Worker; caps here do NOT bound JS/OS memory,
// stack depth, or CPU time. Parent Worker deadlines enforce CPU interruption.
export const GUEST_WASM_MAX_BYTES = 1 << 20;
export const GUEST_MEMORY_MAX_PAGES = 16; // 1 MiB per Wasm instance
export const GUEST_FUNCTION_MAX_COUNT = 1024;

const INVALID = 'E_GUEST_WASM';
function readU32(bytes,offset,end=bytes.length) {
  let value=0;
  for(let shift=0;shift<=28;shift+=7){
    if(offset>=end)throw new Error(INVALID);
    const b=bytes[offset++];
    value+=(b&0x7f)*2**shift;
    if(!(b&0x80)){
      if(value>0xffffffff)throw new Error(INVALID);
      return [value,offset];
    }
  }
  throw new Error(INVALID);
}
function skipName(bytes,offset,end) {
  let length;
  [length,offset]=readU32(bytes,offset,end);
  if(length>end-offset)throw new Error(INVALID);
  return offset+length;
}
function requireBoundedMemory(bytes,offset,end) {
  let flags,minimum,maximum;
  [flags,offset]=readU32(bytes,offset,end);
  // flags=1: 32-bit, unshared memory with explicit maximum. Excludes
  // unbounded, shared memory/threads and memory64 at admission.
  if(flags!==1)throw new Error('E_GUEST_WASM_MEMORY');
  [minimum,offset]=readU32(bytes,offset,end);
  [maximum,offset]=readU32(bytes,offset,end);
  if(minimum>GUEST_MEMORY_MAX_PAGES||maximum>GUEST_MEMORY_MAX_PAGES||
      minimum>maximum)throw new Error('E_GUEST_WASM_MEMORY');
  return offset;
}
function inspectImports(bytes,offset,end) {
  let count;
  [count,offset]=readU32(bytes,offset,end);
  if(count>GUEST_FUNCTION_MAX_COUNT)throw new Error('E_GUEST_WASM_FUNCTIONS');
  for(let i=0;i<count;i++){
    offset=skipName(bytes,offset,end); // module
    offset=skipName(bytes,offset,end); // field
    if(offset>=end)throw new Error(INVALID);
    const kind=bytes[offset++];
    // The atto ABI admits imported functions only. A memory or table import
    // can bypass local memory-section budgets and is rejected before compile.
    if(kind===1)throw new Error('E_GUEST_WASM_TABLE');
    if(kind===2)throw new Error('E_GUEST_WASM_MEMORY');
    if(kind!==0)throw new Error('E_GUEST_WASM_IMPORT');
    [,offset]=readU32(bytes,offset,end); // type index
  }
  if(offset!==end)throw new Error(INVALID);
}
export function admitGuestWasm(bytes,{invalidCode=INVALID}={}) {
  if(!(bytes instanceof Uint8Array)||bytes.byteLength<8||
      bytes.byteLength>GUEST_WASM_MAX_BYTES||
      !WebAssembly.validate(bytes))throw new Error(invalidCode);
  let offset=8;
  while(offset<bytes.length){
    const id=bytes[offset++];
    let length;
    [length,offset]=readU32(bytes,offset);
    if(length>bytes.length-offset)throw new Error(invalidCode);
    const end=offset+length;
    switch(id){
      case 2: inspectImports(bytes,offset,end); break;
      case 3: {
        const [count]=readU32(bytes,offset,end);
        if(count>GUEST_FUNCTION_MAX_COUNT)throw new Error('E_GUEST_WASM_FUNCTIONS');
        break;
      }
      case 4: {
        const [count]=readU32(bytes,offset,end);
        if(count>0)throw new Error('E_GUEST_WASM_TABLE');
        break;
      }
      case 5: {
        let count;
        [count,offset]=readU32(bytes,offset,end);
        if(count>1)throw new Error('E_GUEST_WASM_MEMORY');
        if(count===1)offset=requireBoundedMemory(bytes,offset,end);
        if(offset!==end)throw new Error(invalidCode);
        break;
      }
      case 8: throw new Error('E_GUEST_WASM_START');
    }
    offset=end;
  }
  return bytes;
}
