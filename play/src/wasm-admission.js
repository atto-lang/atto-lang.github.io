// The module header plus each well-formed WebAssembly section is scanned
// after WebAssembly.validate. A start function runs *during instantiation*
// before guest main()/receive() and is prohibited in this browser actor ABI.
export const GUEST_WASM_MAX_BYTES = 1 << 20;

const INVALID = 'E_GUEST_WASM';
function readU32(bytes,offset) {
  let value=0;
  for(let shift=0;shift<=28;shift+=7){
    if(offset>=bytes.length)throw new Error(INVALID);
    const b=bytes[offset++];
    value+=(b&0x7f)*2**shift;
    if(!(b&0x80)){
      if(value>0xffffffff)throw new Error(INVALID);
      return [value,offset];
    }
  }
  throw new Error(INVALID);
}

export function admitGuestWasm(bytes,{invalidCode=INVALID}={}){
  if(!(bytes instanceof Uint8Array)||bytes.byteLength<8||
      bytes.byteLength>GUEST_WASM_MAX_BYTES||
      !WebAssembly.validate(bytes))throw new Error(invalidCode);
  let offset=8;
  while(offset<bytes.length){
    const id=bytes[offset++];
    let length;
    [length,offset]=readU32(bytes,offset);
    if(length>bytes.length-offset)throw new Error(invalidCode);
    if(id===8)throw new Error('E_GUEST_WASM_START');
    offset+=length;
  }
  return bytes;
}
