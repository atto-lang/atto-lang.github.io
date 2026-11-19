import test from 'node:test';
import assert from 'node:assert/strict';
import { createStateRuntime } from '../src/state-runtime.js';
import { guestImports } from '../src/guest.js';
import { validateGuestImportABI } from '../src/guest-import-abi.js';
import { stateGuestProfile } from '../src/state-guest-profile.js';

test('read tickets can coexist, writers cannot overtake, and replay is denied', () => {
  const r = createStateRuntime({maxContainers: 2, maxTickets: 2});
  const {state_register, state_enter, state_leave} = r.imports;
  state_register(0);
  const a=state_enter(0,0), b=state_enter(0,0);
  assert.equal(typeof a,'bigint');
  assert.notEqual(a,b);
  assert.throws(()=>state_enter(0,1),/capacity|contention/);
  state_leave(a);
  state_leave(b);
  const writer=state_enter(0,1);
  assert.throws(()=>state_enter(0,0),/contention/);
  state_leave(writer);
  r.complete();
  assert.equal(r.snapshot().quiescent,true);
  assert.throws(()=>state_leave(writer),/replayed admission ticket/);
  assert.throws(()=>state_enter(0,0),/retired/);
});

test('live ticket cannot silently complete; abort revokes all authority', () => {
  const r=createStateRuntime();
  r.imports.state_register(0);
  const t=r.imports.state_enter(0,1);
  assert.throws(()=>r.complete(),/unreleased state tickets/);
  r.abort();
  assert.equal(r.snapshot().active,0);
  assert.throws(()=>r.imports.state_leave(t),/replayed admission ticket/);
});

test('forged state ticket, pointer and generation cannot cross Worker runtime', () => {
  const a=createStateRuntime(), b=createStateRuntime();
  a.imports.state_register(0);
  b.imports.state_register(0);
  const ticket=a.imports.state_enter(0,1);
  assert.throws(()=>b.imports.state_leave(ticket),/replayed admission ticket/);
  assert.throws(()=>a.imports.state_register(1),/unaligned|invalid/);
  assert.throws(()=>a.imports.state_register(0),/reused/);
  a.imports.state_leave(ticket);
  a.complete(); b.abort();
});

const u32=n=>{const a=[];do {let b=n&127;n>>>=7;if(n)b|=128;a.push(b);}while(n);return a;};
const str=s=>[...u32(s.length),...new TextEncoder().encode(s)];
const sec=(id,data)=>[id,...u32(data.length),...data];
// A real validating Wasm module, with an atto.state_register(i32)->void import
// and a minimal main() -> i64; no source interpreter or fake stub compiler.
function stateGuestBytes(symbol='state_register',signature=0) {
  const types=[2,0x60,1,0x7f,0,0x60,0,1,0x7e];
  const imp=[1,...str('atto'),...str(symbol),0,signature];
  const funcs=[1,1];
  const exports=[1,...str('main'),0,1];
  const code=[1,4,0,0x42,42,0x0b];
  return new Uint8Array([0,97,115,109,1,0,0,0,...sec(1,types),...sec(2,imp),
    ...sec(3,funcs),...sec(7,exports),...sec(10,code)]);
}

test('state imports are denied by default, and signature-checked when explicitly admitted', async () => {
  const bytes=stateGuestBytes();
  assert.ok(WebAssembly.validate(bytes));
  const module=await WebAssembly.compile(bytes);
  assert.throws(()=>validateGuestImportABI(bytes,module),/not granted/);
  assert.throws(()=>guestImports(module,{text:'',truncated:false}),/not granted/);
  assert.deepEqual(validateGuestImportABI(bytes,module,{allowState:true}).map(x=>x.name),['state_register']);
  const runtime=createStateRuntime();
  const bridge=guestImports(module,{text:'',truncated:false},null,null,runtime);
  const instance=await WebAssembly.instantiate(module,bridge.imports);
  bridge.bind(instance);
  assert.equal(instance.exports.main(),42n);
  runtime.complete();
});

test('declared state import cannot spoof ABI signature, even with state opt-in', async () => {
  const bytes=stateGuestBytes('state_register',1);
  assert.ok(WebAssembly.validate(bytes));
  const module=await WebAssembly.compile(bytes);
  assert.throws(()=>validateGuestImportABI(bytes,module,{allowState:true}),/signature mismatch/);
});

test('protected site packager explicitly includes state runtime source', async () => {
  const {readFile}=await import('node:fs/promises');
  const packageSource=await readFile(new URL('../../.github/scripts/package-playground.mjs',import.meta.url),'utf8');
  assert.match(packageSource, /'src\/state-runtime\.js'/);
  assert.match(packageSource, /'src\\/state-guest-profile\\.js'/);
  assert.doesNotMatch(packageSource, /release-candidates\//, 'private compiler candidates cannot be published');
});

function boundedMemoryGuest() {
  // Core Wasm memory(min=1,max=16) exported as "memory".
  const bytes=new Uint8Array([
    0,97,115,109,1,0,0,0,
    5,4,1,1,1,16,
    7,10,1,6,109,101,109,111,114,121,2,0
  ]);
  assert.ok(WebAssembly.validate(bytes));
  return new WebAssembly.Instance(new WebAssembly.Module(bytes));
}

test('production state authority needs an actual bounded guest memory binding', () => {
  const runtime=createStateRuntime({requireBoundMemory:true});
  assert.throws(()=>runtime.imports.state_register(0),/not yet bound/);
  assert.throws(()=>runtime.bind({exports:{memory:new WebAssembly.Memory({initial:1,maximum:16})}}),
    /verified guest instance/);
  const instance=boundedMemoryGuest();
  runtime.bind(instance);
  assert.throws(()=>runtime.bind(instance),/already bound/);
  runtime.imports.state_register(0);
  runtime.imports.state_register(65528);
  assert.throws(()=>runtime.imports.state_register(65536),/outside bounded guest memory/);
  assert.throws(()=>runtime.imports.state_register(65529),/unaligned/);
  const ticket=runtime.imports.state_enter(65528,1);
  runtime.imports.state_leave(ticket);
  runtime.complete();
  assert.throws(()=>runtime.bind(instance),/retired/);
});

test('state runtime refuses missing, shared or oversized guest memory', () => {
  const r=createStateRuntime({requireBoundMemory:true});
  // A guest module without memory cannot register an abstract pointer.
  const bytes=new Uint8Array([0,97,115,109,1,0,0,0]);
  const noMemory=new WebAssembly.Instance(new WebAssembly.Module(bytes));
  assert.throws(()=>r.bind(noMemory),/bounded private state guest memory/);
  assert.throws(()=>r.imports.state_register(0),/not yet bound/);
  assert.throws(()=>createStateRuntime({requireBoundMemory:'yes'}),/invalid memory binding policy/);
  r.abort();
});

function stateTriadGuest({ hooks=['state_register','state_enter','state_leave'], actor=false }={}) {
  const signatures={
    state_register:0, state_enter:1, state_leave:2, actor_spawn:0
  };
  const typeSec=[4,0x60,1,0x7f,0,0x60,2,0x7f,0x7f,1,0x7e,
    0x60,1,0x7e,0,0x60,0,1,0x7e];
  const names=[...hooks,...(actor?['actor_spawn']:[])];
  const imports=[...u32(names.length)];
  for(const n of names)imports.push(...str('atto'),...str(n),0,signatures[n]);
  const funcs=[1,3];
  const exports=[1,...str('main'),0,names.length];
  const code=[1,4,0,0x42,42,0x0b];
  const wasm=new Uint8Array([0,97,115,109,1,0,0,0,
    ...sec(1,typeSec),...sec(2,imports),...sec(3,funcs),
    ...sec(7,exports),...sec(10,code)]);
  assert.ok(WebAssembly.validate(wasm));
  return {wasm,module:new WebAssembly.Module(wasm)};
}

test('state host ABI admits only the complete lifecycle, not partial hook imports', () => {
  const single=stateTriadGuest({hooks:['state_enter']});
  assert.throws(()=>stateGuestProfile(single.module),/complete .* lifecycle/);
  const full=stateTriadGuest();
  assert.equal(stateGuestProfile(full.module),true);
  assert.deepEqual(validateGuestImportABI(full.wasm,full.module,{allowState:true})
    .map(i=>i.name),['state_register','state_enter','state_leave']);
  assert.throws(()=>validateGuestImportABI(full.wasm,full.module),/not granted/);
  assert.equal(stateGuestProfile(new WebAssembly.Module(new Uint8Array(
    [0,97,115,109,1,0,0,0]))),false);
});

test('state admission rejects actor and pipeline mixed capabilities before instance', () => {
  const full=stateTriadGuest();
  assert.throws(()=>stateGuestProfile(full.module,{actorTypes:1}),/cannot mix/);
  assert.throws(()=>stateGuestProfile(full.module,{pipeline:true}),/cannot mix/);
  const mixed=stateTriadGuest({actor:true});
  assert.throws(()=>stateGuestProfile(mixed.module),/cannot mix/);
});
