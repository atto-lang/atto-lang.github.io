import test from 'node:test';
import assert from 'node:assert/strict';
import {createStateRuntime} from '../src/state-runtime.js';
import {stateGuestProfile} from '../src/state-guest-profile.js';

const u32=n=>{const out=[];do{let b=n&127;n>>>=7;if(n)b|=128;out.push(b);}while(n);return out;};
const text=s=>[...u32(s.length),...new TextEncoder().encode(s)];
const section=(id,body)=>[id,...u32(body.length),...body];

function guestModuleWithImports(names) {
  const types=[3,0x60,1,0x7f,0,0x60,2,0x7f,0x7f,1,0x7e,0x60,1,0x7e,0];
  const signatures={state_register:0,state_enter:1,state_leave:2,actor_spawn:0};
  const imports=[...u32(names.length)];
  for(const name of names) imports.push(...text('atto'),...text(name),0,signatures[name]);
  const bytes=new Uint8Array([0,97,115,109,1,0,0,0,...section(1,types),...section(2,imports)]);
  assert.ok(WebAssembly.validate(bytes));
  return new WebAssembly.Module(bytes);
}

function memoryInstance() {
  // Declares memory(min=1,max=16) and exports it by name "memory".
  const bytes=new Uint8Array([0,97,115,109,1,0,0,0,5,4,1,1,1,16,
    7,10,1,6,109,101,109,111,114,121,2,0]);
  assert.ok(WebAssembly.validate(bytes));
  return new WebAssembly.Instance(new WebAssembly.Module(bytes));
}

test('predictable forged i64 lease cannot release or downgrade a live writer',()=>{
  const runtime=createStateRuntime({requireBoundMemory:false});
  runtime.imports.state_register(0);
  const writer=runtime.imports.state_enter(0,1);
  const oldGuess=(BigInt(runtime.snapshot().actorIncarnation)<<32n)|1n;
  assert.notEqual(writer,oldGuess,'published counter-derived ticket can be forged');
  assert.throws(()=>runtime.imports.state_leave(oldGuess),/missing or replayed admission ticket/);
  assert.equal(runtime.snapshot().active,1);
  assert.throws(()=>runtime.imports.state_enter(0,0),/contention/);
  runtime.imports.state_leave(writer);
  const successor=runtime.imports.state_enter(0,1);
  assert.notEqual(successor,writer);
  assert.throws(()=>runtime.imports.state_leave(writer),/missing or replayed admission ticket/);
  runtime.imports.state_leave(successor);
  runtime.complete();
});

test('secure default rejects unbound and out-of-range state guest memory',()=>{
  const runtime=createStateRuntime();
  assert.throws(()=>runtime.imports.state_register(0),/memory not yet bound/);
  const instance=memoryInstance();
  runtime.bind(instance);
  assert.throws(()=>runtime.bind(instance),/already bound/);
  runtime.imports.state_register(0);
  runtime.imports.state_register(65528);
  assert.throws(()=>runtime.imports.state_register(65536),/outside bounded guest memory/);
  assert.throws(()=>runtime.imports.state_register(7),/unaligned/);
  const claim=runtime.imports.state_enter(65528,1);
  assert.throws(()=>runtime.imports.state_enter(65528,0),/contention/);
  runtime.imports.state_leave(claim);
  runtime.complete();
});

test('ticket issuance remains bounded and cannot be revived by replay',()=>{
  const runtime=createStateRuntime({requireBoundMemory:false,maxTickets:1,maxTicketIssuance:2});
  runtime.imports.state_register(0);
  const a=runtime.imports.state_enter(0,0);runtime.imports.state_leave(a);
  const b=runtime.imports.state_enter(0,0);runtime.imports.state_leave(b);
  assert.throws(()=>runtime.imports.state_enter(0,0),/total ticket issuance capacity/);
  assert.throws(()=>runtime.imports.state_leave(a),/missing or replayed admission ticket/);
  runtime.abort();
  assert.throws(()=>runtime.imports.state_enter(0,0),/retired/);
});

test('partial/mixed state imports never gain state authority',()=>{
  const partial=guestModuleWithImports(['state_enter']);
  assert.throws(()=>stateGuestProfile(partial),/complete state_register\/enter\/leave/);
  const complete=guestModuleWithImports(['state_register','state_enter','state_leave']);
  assert.equal(stateGuestProfile(complete),true);
  const mixed=guestModuleWithImports(['state_register','state_enter','state_leave','actor_spawn']);
  assert.throws(()=>stateGuestProfile(mixed),/cannot mix/);
  assert.throws(()=>stateGuestProfile(complete,{actorTypes:1}),/cannot mix/);
  assert.throws(()=>stateGuestProfile(complete,{pipeline:true}),/cannot mix/);
});
