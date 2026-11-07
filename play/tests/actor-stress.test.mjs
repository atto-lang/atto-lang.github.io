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
