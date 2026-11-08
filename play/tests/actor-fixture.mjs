/** Source-free test module: proves isolated browser workers, not compiler support. */
const leb = n => {
  const out = [];
  do { let b = n % 128; n = Math.floor(n / 128); if (n) b |= 128; out.push(b); } while (n);
  return out;
};
const str = s => [...leb(Buffer.byteLength(s)), ...Buffer.from(s, 'utf8')];
const section = (id, bytes) => [id, ...leb(bytes.length), ...bytes];
const fnType = (args, result) => [0x60, ...leb(args.length), ...args, ...leb(result.length), ...result];
const funcImport = (name, signature) => [...str('atto'), ...str(name), 0, ...leb(signature)];
const exportFunc = (name, idx) => [...str(name), 0, ...leb(idx)];
const exportGlobal = (name, idx) => [...str(name), 3, ...leb(idx)];
const body = bytes => [...leb(bytes.length), ...bytes];

/** A guest whose main spawns two actors and sends them the same value.
 * receive uses a mutable global that must belong separately to each worker.
 */
export function actorProgramFixture({ twoActors = true, stuckReceive = false } = {}) {
  const i32 = 0x7f, i64 = 0x7e;
  const types = [
    fnType([], [i64]),
    fnType([i64], [i64]),
    fnType([i32], [i32]),
    fnType([i32, i64], [i32]),
    fnType([i32], []),
  ];
  const init = [
    0x41, 0, 0x10, 0, 0x21, 0,
    ...(twoActors ? [0x41, 0, 0x10, 0, 0x21, 1] : []),
    0x20, 0, 0x42, 41, 0x10, 1, 0x1a,
    ...(twoActors ? [0x20, 1, 0x42, 41, 0x10, 1, 0x1a] : []),
    0x20, 0, 0x10, 2,
    ...(twoActors ? [0x20, 1, 0x10, 2] : []),
    0x42, 42, 0x0b,
  ];
  const receive = stuckReceive
    // Deliberately infinite nested-worker Wasm loop. Parent cancellation must
    // terminate the child without waiting for cooperative guest execution.
    ? [0,0x03,0x40,0x0c,0,0x0b,0x42,0,0x0b]
    : [
      0,
      0x23, 1, 0x42, 1, 0x7c, 0x24, 1,
      0x20, 0, 0x23, 1, 0x7c, 0x0b,
    ];
  const main = [...(twoActors ? [1,2,i32] : [1,1,i32]), ...init];
  const bytes = Uint8Array.from([
    0,97,115,109,1,0,0,0,
    ...section(1, [...leb(types.length), ...types.flat()]),
    ...section(2, [3, ...funcImport('actor_spawn',2), ...funcImport('actor_send',3), ...funcImport('actor_join',4)]),
    ...section(3, [2,0,1]),
    ...section(6, [2, i32,1,0x41,0,0x0b, i64,1,0x42,0,0x0b]),
    ...section(7, [3, ...exportFunc('main',3), ...exportGlobal('panic_code',0), ...exportFunc('atto_actor_receive_0',4)]),
    ...section(10, [2, ...body(main), ...body(receive)]),
  ]);
  if (!WebAssembly.validate(bytes)) throw new Error('Invalid source-free actor fixture');
  return bytes;
}

/** Legacy scalar.v0 bytecode has a bare receive export, no main or actor
 * imports. It is deliberately valid Wasm but INVALID for integrated.v1. */
export function scalarV0ActorFixture() {
  const i64 = 0x7e;
  const bytes = Uint8Array.from([
    0,97,115,109,1,0,0,0,
    ...section(1, [1, ...fnType([i64], [i64])]),
    ...section(3, [1,0]),
    ...section(7, [1, ...exportFunc('receive',0)]),
    ...section(10, [1, ...body([0,0x20,0,0x42,1,0x7c,0x0b])]),
  ]);
  if (!WebAssembly.validate(bytes)) throw new Error('Invalid scalar.v0 fixture');
  return bytes;
}


// This valid source-free Wasm checks the admission result of every send,
// executes four actor mailboxes at capacity, and optionally attempts actor 5.
// A result of 42 means the guest observed every expected OK/FULL return.
export function actorStressFixture({actorCount=4,messagesPerActor=33,stuckReceive=false}={}) {
  if(!Number.isInteger(actorCount)||actorCount<1||actorCount>5||
     !Number.isInteger(messagesPerActor)||messagesPerActor<1||messagesPerActor>33)
    throw new Error('Invalid stress bounds');
  const i32=0x7f,i64=0x7e;
  const types=[
    fnType([],[i64]),fnType([i64],[i64]),
    fnType([i32],[i32]),fnType([i32,i64],[i32]),fnType([i32],[])
  ];
  const code=[];
  for(let a=0;a<actorCount;a++)code.push(0x41,0,0x10,0,0x21,a);
  for(let a=0;a<actorCount;a++)for(let m=0;m<messagesPerActor;m++){
    const expected=m<32?0:2;
    code.push(0x20,a,0x42,m,0x10,1,0x41,expected,0x47,
      0x20,actorCount,0x6a,0x21,actorCount);
  }
  for(let a=0;a<actorCount;a++)code.push(0x20,a,0x10,2);
  code.push(0x20,actorCount,0xad,0x42,42,0x7c,0x0b);
  const main=[1,actorCount+1,i32,...code];
  const receive=stuckReceive
    ? [0,0x03,0x40,0x0c,0,0x0b,0x42,0,0x0b] // noncooperative loop
    : [0,0x23,1,0x42,1,0x7c,0x24,1,0x20,0,0x23,1,0x7c,0x0b];
  const bytes=Uint8Array.from([
    0,97,115,109,1,0,0,0,
    ...section(1,[...leb(types.length),...types.flat()]),
    ...section(2,[3,...funcImport('actor_spawn',2),
      ...funcImport('actor_send',3),...funcImport('actor_join',4)]),
    ...section(3,[2,0,1]),
    ...section(6,[2,i32,1,0x41,0,0x0b,i64,1,0x42,0,0x0b]),
    ...section(7,[3,...exportFunc('main',3),
      ...exportGlobal('panic_code',0),...exportFunc('atto_actor_receive_0',4)]),
    ...section(10,[2,...body(main),...body(receive)])
  ]);
  if(!WebAssembly.validate(bytes))throw new Error('Invalid stress Wasm fixture');
  return bytes;
}


/** Valid Wasm with an automatic start function. It must be refused by
 * the host before instantiation even though WebAssembly.validate succeeds. */
export function startSectionWasmFixture(){
  const bytes=Uint8Array.from([
    0,97,115,109,1,0,0,0,
    ...section(1,[1,...fnType([],[])]),
    ...section(3,[1,0]),
    ...section(8,[0]),
    ...section(10,[1,...body([0,0x0b])])
  ]);
  if(!WebAssembly.validate(bytes))throw new Error('Invalid start section fixture');
  return bytes;
}


/** Small spec-valid Wasm modules demonstrating that byte limits alone do
 * not prevent large/unbounded memory or table allocation. */
export function resourceWasmFixture(kind='bounded') {
  const variants={
    bounded:section(5,[1,1,1,16]), // 1 page initial, 16-page maximum
    unbounded:section(5,[1,0,1]), // valid, but no maximum
    tooLarge:section(5,[1,1,1,32]), // 2 MiB max
    tooLargeInitial:section(5,[1,1,17,17]),
    table:section(4,[1,0x70,0,1]), // local funcref table
    importedMemory:section(2,[1,...str('host'),...str('mem'),2,1,1,16]),
    importedTable:section(2,[1,...str('host'),...str('table'),1,0x70,0,1]),
  };
  if(!Object.hasOwn(variants,kind))throw new Error('Unknown Wasm resource fixture');
  const memExport=kind==='bounded'
    ?section(7,[1,...str('memory'),2,0]):[];
  const bytes=Uint8Array.from([0,97,115,109,1,0,0,0,...variants[kind],...memExport]);
  if(!WebAssembly.validate(bytes))
    throw new Error('Resource fixture must be valid WebAssembly: '+kind);
  return bytes;
}
