// Deterministic actor stress/fault matrix. Worker doubles are injected and
// counted; separate Chromium E2E proves real nested Worker execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import {ActorSession,ACTOR_ADMISSION,ACTOR_PROTOCOL_VERSION} from '../src/actor-lifecycle.js';
import {actorStressFixture} from './actor-fixture.mjs';

class ControlledWorker {
  constructor(mode='success'){this.mode=mode;this.terminated=0;this.messages=[];this.processed=0;}
  postMessage(m){
    this.messages.push(m);
    if(m.kind==='init'){
      if(this.mode!=='hold_ready')queueMicrotask(()=>this.emit({kind:'ready',
        actorId:m.actorId,version:ACTOR_PROTOCOL_VERSION}));
    }else if(m.kind==='message'){
      if(this.mode==='panic')queueMicrotask(()=>this.emit({kind:'error',message:'E_ACTOR_PANIC_1'}));
      else if(this.mode==='hold_reply')return;
      else queueMicrotask(()=>{this.processed++;this.emit({kind:'reply',
        actorId:m.actorId,seq:m.seq,value:m.value+1n});});
    }else if(m.kind==='close'&&this.mode!=='hold_done'){
      queueMicrotask(()=>this.emit({kind:'done',actorId:m.actorId,
        version:ACTOR_PROTOCOL_VERSION,processed:this.processed,lastSeq:this.processed}));
    }
  }
  emit(data){this.onmessage?.({data});}
  terminate(){this.terminated++;}
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('source-free stress Wasm reports accurate 4x32 mailbox admission',()=>{
  const module=new WebAssembly.Module(actorStressFixture());
  assert.deepEqual(WebAssembly.Module.imports(module).map(x=>x.name),
    ['actor_spawn','actor_send','actor_join']);
  assert.deepEqual(WebAssembly.Module.exports(module).map(x=>x.name),
    ['main','panic_code','atto_actor_receive_0']);
  const queues=Array.from({length:4},()=>[]);
  let spawned=0;
  const atto={
    actor_spawn:()=>++spawned,
    actor_send:(handle,value)=>{
      const q=queues[handle-1];
      if(!q)return ACTOR_ADMISSION.INVALID;
      if(q.length===32)return ACTOR_ADMISSION.FULL;
      q.push(value);return ACTOR_ADMISSION.OK;
    },
    actor_join:handle=>assert.ok(handle>=1&&handle<=4)
  };
  assert.equal(new WebAssembly.Instance(module,{atto}).exports.main(),42n);
  assert.equal(spawned,4);
  for(const q of queues)assert.deepEqual(q,Array.from({length:32},(_,i)=>BigInt(i)));
});

test('120 deterministic actor lifecycle failure/cancellation trials',async()=>{
  for(let iteration=0;iteration<120;iteration++){
    const kind=iteration%8;
    const mode=kind===1?'hold_ready':kind===2?'hold_reply':
      kind===3?'hold_done':kind===4?'panic':'success';
    const w=new ControlledWorker(mode);
    const a=new ActorSession(w,iteration%4,new Uint8Array(),
      {timeout_ms:kind>=1&&kind<=3?15:500});
    const delivered=[];
    const count=kind===0?32:kind===5?0:kind===6?2:3;
    for(let i=0;i<count;i++)assert.equal(a.admit(BigInt(i)),ACTOR_ADMISSION.OK);
    if(kind===0)assert.equal(a.admit(33n),ACTOR_ADMISSION.FULL);
    const draining=a.drain_and_close((message,reply)=>{
      delivered.push([message,reply]);
      if(kind===6)a.cancel();
    });
    if(kind===7)a.cancel();
    const results=await Promise.allSettled([draining,a.get_done()]);
    assert.equal(results[0].status,results[1].status,'terminal task disagreement at '+iteration);
    assert.equal(w.terminated,1,'leaked or double-terminated worker at '+iteration);
    assert.equal(a.is_terminal(),true);
    assert.equal(a.admit(42n),ACTOR_ADMISSION.CLOSED);
    if(kind===0||kind===5){
      assert.equal(results[0].status,'fulfilled');
      assert.equal(results[0].value.processed,count);
      assert.equal(delivered.length,count);
      assert.equal(w.messages.filter(m=>m.kind==='message').length,count);
      assert.equal(w.messages.filter(m=>m.kind==='close').length,1);
    }else{
      assert.equal(results[0].status,'rejected','trial '+iteration);
      assert.equal(w.messages.filter(m=>m.kind==='close').length,kind===3?1:0);
      if(kind===1||kind===7)
        assert.equal(w.messages.filter(m=>m.kind==='message').length,0);
    }
    const before=a.state;
    w.emit({kind:'ready',actorId:a.actor_id,version:ACTOR_PROTOCOL_VERSION});
    w.emit({kind:'done',actorId:a.actor_id,version:ACTOR_PROTOCOL_VERSION,
      processed:999,lastSeq:999});
    assert.equal(a.state,before,'terminal state resurrected');
    assert.equal(w.terminated,1,'late message double-terminated child');
  }
});

test('40 rounds cancel four simultaneous outstanding child receives',async()=>{
  for(let round=0;round<40;round++){
    const workers=Array.from({length:4},()=>new ControlledWorker('hold_reply'));
    const actors=workers.map((w,i)=>new ActorSession(w,i,new Uint8Array(),{timeout_ms:1000}));
    const tasks=actors.map(a=>{
      for(let i=0;i<32;i++)assert.equal(a.admit(BigInt(i)),ACTOR_ADMISSION.OK);
      assert.equal(a.admit(32n),ACTOR_ADMISSION.FULL);
      return a.drain_and_close();
    });
    await tick();
    assert.ok(workers.every(w=>w.messages.some(m=>m.kind==='message')));
    for(const a of actors)a.cancel();
    const results=await Promise.allSettled(tasks);
    assert.ok(results.every(x=>x.status==='rejected'));
    for(let i=0;i<4;i++){
      assert.equal(actors[i].state,'cancelled');
      assert.equal(workers[i].terminated,1);
      assert.equal(workers[i].messages.filter(m=>m.kind==='close').length,0);
      assert.equal(actors[i].admit(100n),ACTOR_ADMISSION.CLOSED);
    }
  }
});


test('actor scope drains four worker mailboxes concurrently in stable spawn order',async()=>{
  const {ActorScope}=await import('../src/actor-lifecycle.js');
  const workers=[
    new ControlledWorker('success'),
    new ControlledWorker('success'),
    new ControlledWorker('success'),
    new ControlledWorker('success')
  ];
  const scope=new ActorScope();
  const sessions=workers.map((worker,i)=>new ActorSession(worker,i,new Uint8Array()));
  for(const actor of sessions){
    assert.equal(scope.add(actor)>=1,true);
    assert.equal(actor.admit(41n),ACTOR_ADMISSION.OK);
  }
  const {completed,replies}=await scope.drain_all();
  assert.deepEqual(completed.map(x=>x.processed),[1,1,1,1]);
  assert.deepEqual(replies,Array.from({length:4},()=>[[41n,42n]]));
  assert.equal(scope.closed,true);
  assert.equal(sessions.every(a=>a.is_terminal()),true);
  assert.equal(workers.every(w=>w.terminated===1),true);
  scope.cancel_all();
  assert.equal(workers.every(w=>w.terminated===1),true);
});

test('failing one actor cancels all pending siblings with exactly-once termination',async()=>{
  const {ActorScope}=await import('../src/actor-lifecycle.js');
  for(let round=0;round<40;round++){
    const workers=[
      new ControlledWorker('panic'),
      new ControlledWorker('hold_reply'),
      new ControlledWorker('hold_ready'),
      new ControlledWorker('hold_done')
    ];
    const scope=new ActorScope();
    const sessions=workers.map((w,i)=>new ActorSession(w,i,new Uint8Array(),{timeout_ms:1000}));
    for(const actor of sessions){
      scope.add(actor);
      assert.equal(actor.admit(41n),ACTOR_ADMISSION.OK);
    }
    await assert.rejects(scope.drain_all(),/E_ACTOR_PANIC_1/);
    const done=await Promise.allSettled(sessions.map(a=>a.get_done()));
    assert.equal(done.filter(x=>x.status==='rejected').length,4);
    assert.ok(workers.every(w=>w.terminated===1));
    assert.ok(sessions.every(a=>a.is_terminal()));
    for(const actor of sessions)assert.equal(actor.admit(42n),ACTOR_ADMISSION.CLOSED);
  }
});

test('parent scope cancellation aborts all four outstanding children',async()=>{
  const {ActorScope}=await import('../src/actor-lifecycle.js');
  for(let round=0;round<40;round++){
    const workers=Array.from({length:4},()=>new ControlledWorker('hold_reply'));
    const scope=new ActorScope();
    const sessions=workers.map((w,i)=>new ActorSession(w,i,new Uint8Array(),{timeout_ms:1000}));
    for(const actor of sessions){
      scope.add(actor);
      assert.equal(actor.admit(41n),ACTOR_ADMISSION.OK);
    }
    const draining=scope.drain_all();
    await tick();
    assert.ok(workers.every(w=>w.messages.some(m=>m.kind==='message')));
    scope.cancel_all();
    await assert.rejects(draining,/E_ACTOR_CANCELLED/);
    assert.ok(workers.every(w=>w.terminated===1));
    assert.ok(sessions.every(a=>a.state==='cancelled'));
    assert.ok(workers.every(w=>w.messages.every(m=>m.kind!=='close')));
  }
});

test('scope refuses fifth child and post-close spawns, freeing rejected child',async()=>{
  const {ActorScope}=await import('../src/actor-lifecycle.js');
  const scope=new ActorScope();
  const workers=Array.from({length:6},()=>new ControlledWorker('hold_ready'));
  const actors=workers.map((w,i)=>new ActorSession(w,i,new Uint8Array()));
  for(let i=0;i<4;i++)assert.equal(scope.add(actors[i]),i+1);
  assert.throws(()=>scope.add(actors[4]),/E_ACTOR_LIMIT_OR_ID/);
  assert.equal(workers[4].terminated,1);
  scope.cancel_all();
  assert.throws(()=>scope.add(actors[5]),/E_ACTOR_SCOPE_CLOSED/);
  assert.ok(workers.every(w=>w.terminated===1));
});
