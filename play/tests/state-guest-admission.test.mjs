import test from 'node:test';
import assert from 'node:assert/strict';
import { createStateRuntime } from '../src/state-runtime.js';
import { guestImports } from '../src/guest.js';
import { validateGuestImportABI } from '../src/guest-import-abi.js';

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
