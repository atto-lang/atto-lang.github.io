// Deliberately source-free WebAssembly host capability canary.
// Passing this canary does NOT demonstrate AttoLang source compilation or actor isolation.
const bytes=Uint8Array.from([
  0,97,115,109,1,0,0,0,
  1,5,1,96,0,1,127,
  3,2,1,0,
  5,3,1,0,1,
  7,19,2,6,97,110,115,119,101,114,0,0,6,109,101,109,111,114,121,2,0,
  10,6,1,4,0,65,42,11
]);
self.addEventListener('message',async e=>{
 if(e.data?.kind!=='probe')return;
 const tests=[];
 try{
  const module=await WebAssembly.compile(bytes);
  const a=await WebAssembly.instantiate(module,{}),b=await WebAssembly.instantiate(module,{});
  tests.push({name:'Execute Wasm inside Worker',pass:a.exports.answer()===42,detail:'source-free Wasm answer() → 42'});
  const ma=a.exports.memory,mb=b.exports.memory;
  const distinct=ma instanceof WebAssembly.Memory && mb instanceof WebAssembly.Memory && ma!==mb && ma.buffer!==mb.buffer;
  tests.push({name:'Two separate Wasm memories',pass:distinct,detail:'module instance A and B have distinct memory objects'});
  if(distinct){const va=new Uint8Array(ma.buffer),vb=new Uint8Array(mb.buffer);va[0]=173;tests.push({name:'Instance memory non-aliasing',pass:vb[0]!==173,detail:'write to instance A did not change instance B'});}
  try{const bounded=new WebAssembly.Memory({initial:1,maximum:2});bounded.grow(1);let blocked=false;try{bounded.grow(1);}catch(_){blocked=true;}tests.push({name:'Bounded wasm32 linear memory',pass:blocked,detail:'maximum two 64-KiB pages enforced'});}catch(err){tests.push({name:'Bounded wasm32 linear memory',pass:false,detail:String(err)});}
 }catch(err){tests.push({name:'Wasm Worker module execution',pass:false,detail:String(err)});}
 self.postMessage({kind:'result',tests});
});
