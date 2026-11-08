import test from 'node:test';
import assert from 'node:assert/strict';
import {admitGuestWasm,GUEST_WASM_MAX_BYTES} from '../src/wasm-admission.js';
import {actorProgramFixture,scalarV0ActorFixture,
  startSectionWasmFixture} from './actor-fixture.mjs';

test('admit valid actor and legacy scalar module bytes (ABI separately enforced)',()=>{
  for(const bytes of [actorProgramFixture(),scalarV0ActorFixture()]){
    assert.equal(admitGuestWasm(bytes),bytes);
  }
});
test('forbid valid Wasm start function before any guest instantiation',()=>{
  const start=startSectionWasmFixture();
  assert.equal(WebAssembly.validate(start),true);
  assert.throws(()=>admitGuestWasm(start),/E_GUEST_WASM_START/);
});
test('invalid input, oversized bytecode and malformed section bounds fail closed',()=>{
  for(const bytes of [null,undefined,{},'not wasm',new Uint8Array(),
    new Uint8Array(7),new Uint8Array(GUEST_WASM_MAX_BYTES+1),
    new Uint8Array([0,97,115,109,1,0,0,0,8,255,255,255])]){
    assert.throws(()=>admitGuestWasm(bytes),/E_GUEST_WASM/);
  }
});
test('actor-specific invalid code is preserved, start denial stays explicit',()=>{
  assert.throws(()=>admitGuestWasm(new Uint8Array(GUEST_WASM_MAX_BYTES+1),
    {invalidCode:'E_ACTOR_WASM'}),/E_ACTOR_WASM/);
  assert.throws(()=>admitGuestWasm(startSectionWasmFixture(),
    {invalidCode:'E_ACTOR_WASM'}),/E_GUEST_WASM_START/);
});
test('valid custom sections do not bypass start detection',()=>{
  const module=startSectionWasmFixture();
  const withCustom=Uint8Array.from([...module,0,2,1,88]);
  assert.equal(WebAssembly.validate(withCustom),true);
  assert.throws(()=>admitGuestWasm(withCustom),/E_GUEST_WASM_START/);
});


test('bounded local memory is admitted and WebAssembly enforces its growth ceiling',async()=>{
  const {resourceWasmFixture}=await import('./actor-fixture.mjs');
  const wasm=resourceWasmFixture('bounded');
  assert.equal(admitGuestWasm(wasm),wasm);
  const instance=new WebAssembly.Instance(new WebAssembly.Module(wasm),{});
  assert.equal(instance.exports.memory.buffer.byteLength,65536);
  assert.equal(instance.exports.memory.grow(15),1);
  assert.equal(instance.exports.memory.buffer.byteLength,16*65536);
  assert.throws(()=>instance.exports.memory.grow(1),RangeError);
});
test('small valid Wasm cannot allocate unbounded, large or imported memories',async()=>{
  const {resourceWasmFixture}=await import('./actor-fixture.mjs');
  for(const kind of ['unbounded','tooLarge','tooLargeInitial','importedMemory']){
    const bytes=resourceWasmFixture(kind);
    assert.ok(bytes.byteLength<128);
    assert.equal(WebAssembly.validate(bytes),true);
    assert.throws(()=>admitGuestWasm(bytes),/E_GUEST_WASM_MEMORY/,kind);
  }
});
test('small valid Wasm cannot introduce hidden or imported tables',async()=>{
  const {resourceWasmFixture}=await import('./actor-fixture.mjs');
  for(const kind of ['table','importedTable']){
    const wasm=resourceWasmFixture(kind);
    assert.equal(WebAssembly.validate(wasm),true);
    assert.throws(()=>admitGuestWasm(wasm),/E_GUEST_WASM_TABLE/,kind);
  }
});
