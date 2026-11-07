// Node tests for the same lifecycle state machine used by real Chromium.
// Fake workers are injected *only* here for precise protocol/race controls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ActorSession, ACTOR_ADMISSION, ACTOR_PROTOCOL_VERSION } from '../src/actor-lifecycle.js';

class FakeActorWorker {
  constructor(options = {}) {
    this.options = options;
    this.messages = [];
    this.terminated = 0;
    this.received = 0;
  }
  emit(data) {
    this.onmessage?.({data});
  }
  postMessage(msg) {
    this.messages.push(msg);
    if (msg.kind === 'init') {
      if (!this.options.hold_ready) queueMicrotask(() => this.emit({kind:'ready',actorId:msg.actorId,version:ACTOR_PROTOCOL_VERSION}));
      return;
    }
    if (msg.kind === 'message') {
      if (this.options.panic) {
        queueMicrotask(() => this.emit({kind:'error',message:'E_ACTOR_PANIC_1'}));
      } else if (!this.options.hold_reply) {
        this.received++;
        queueMicrotask(() => this.emit({kind:'reply',actorId:msg.actorId,seq:msg.seq,value:msg.value+1n}));
      }
      return;
    }
    if (msg.kind === 'close' && !this.options.hold_done) {
      const processed = this.received + (this.options.bad_done_count ? 1 : 0);
      queueMicrotask(() => this.emit({kind:'done',actorId:msg.actorId,version:ACTOR_PROTOCOL_VERSION,processed,lastSeq:processed}));
    }
  }
  terminate() {
    this.terminated++;
  }
}

test('get_done is pending until an explicit terminal worker acknowledgement', async () => {
  const worker = new FakeActorWorker({hold_done:true});
  const actor = new ActorSession(worker,0,new Uint8Array(),{timeout_ms:300});
  assert.strictEqual(actor.get_done(),actor.get_done(),'one stable completion task');
  assert.equal(actor.admit(41n),ACTOR_ADMISSION.OK);
  const observed=[];
  const draining=actor.drain_and_close((message,reply)=>observed.push([message,reply]));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(actor.state,'closing');
  assert.equal(actor.admit(42n),ACTOR_ADMISSION.CLOSED);
  let settled=false;
  void actor.get_done().then(()=>{settled=true;},()=>{settled=true;});
  await Promise.resolve();
  assert.equal(settled,false,'mailbox admission and reply do not complete lifecycle');
  assert.deepEqual(worker.messages.map(x=>x.kind),['init','message','close']);
  worker.emit({kind:'done',actorId:0,version:ACTOR_PROTOCOL_VERSION,processed:1,lastSeq:1});
  assert.deepEqual(await draining,{kind:'completed',actor_id:0,processed:1});
  assert.deepEqual(observed,[[41n,42n]]);
  assert.equal(actor.state,'completed');
  assert.equal(settled,true);
  const count=worker.terminated;
  worker.emit({kind:'error',message:'E_ACTOR_PANIC_1'});
  assert.equal(actor.state,'completed','late errors cannot mutate terminal result');
  assert.equal(worker.terminated,count);
});

test('bounded admission is linearized before async delivery', async () => {
  const worker=new FakeActorWorker();
  const actor=new ActorSession(worker,1,new Uint8Array(),{timeout_ms:500});
  for(let i=0;i<32;i++)assert.equal(actor.admit(BigInt(i)),ACTOR_ADMISSION.OK);
  assert.equal(actor.admit(32n),ACTOR_ADMISSION.FULL);
  assert.equal(actor.admit({pointer:42}),ACTOR_ADMISSION.INVALID);
  const replies=[];
  const result=await actor.drain_and_close((value,reply)=>replies.push([value,reply]));
  assert.equal(result.processed,32);
  assert.equal(worker.messages.filter(x=>x.kind==='message').length,32);
  assert.deepEqual(replies.map(x=>x[0]),Array.from({length:32},(_,i)=>BigInt(i)));
  assert.equal(actor.admit(33n),ACTOR_ADMISSION.CLOSED);
});

test('actor panic rejects task, stops worker, never resolves success', async () => {
  const worker=new FakeActorWorker({panic:true});
  const actor=new ActorSession(worker,0,new Uint8Array());
  actor.admit(1n);
  await assert.rejects(actor.drain_and_close(),/E_ACTOR_PANIC_1/);
  await assert.rejects(actor.get_done(),/E_ACTOR_PANIC_1/);
  assert.equal(actor.state,'failed');
  assert.equal(worker.terminated,1);
  worker.emit({kind:'done',processed:1});
  await assert.rejects(actor.get_done(),/E_ACTOR_PANIC_1/);
});

test('cancellation before readiness rejects all future completion and admissions', async () => {
  const worker=new FakeActorWorker({hold_ready:true});
  const actor=new ActorSession(worker,2,new Uint8Array());
  actor.admit(1n);
  const task=actor.get_done();
  actor.cancel();
  worker.emit({kind:'ready'});
  worker.emit({kind:'done',processed:0});
  await assert.rejects(task,/E_ACTOR_CANCELLED/);
  await assert.rejects(actor.drain_and_close(),/E_ACTOR_CANCELLED/);
  assert.equal(actor.state,'cancelled');
  assert.equal(actor.admit(2n),ACTOR_ADMISSION.CLOSED);
});

test('missing terminal acknowledgement cannot be mistaken for completion', async () => {
  const worker=new FakeActorWorker({hold_done:true});
  const actor=new ActorSession(worker,0,new Uint8Array(),{timeout_ms:35});
  await assert.rejects(actor.drain_and_close(),/E_ACTOR_DONE_TIMEOUT/);
  await assert.rejects(actor.get_done(),/E_ACTOR_DONE_TIMEOUT/);
  assert.equal(actor.state,'failed');
  assert.equal(worker.terminated,1);
});

test('incorrect final count fails closed even after all replies', async () => {
  const worker=new FakeActorWorker({bad_done_count:true});
  const actor=new ActorSession(worker,0,new Uint8Array());
  actor.admit(12n);
  await assert.rejects(actor.drain_and_close(),/E_ACTOR_DONE_PROTOCOL/);
  await assert.rejects(actor.get_done(),/E_ACTOR_DONE_PROTOCOL/);
  assert.equal(actor.state,'failed');
});

test('unsolicited reply and unexpected protocol are terminal faults', async () => {
  const worker=new FakeActorWorker({hold_ready:true});
  const actor=new ActorSession(worker,0,new Uint8Array());
  worker.emit({kind:'reply',value:10n});
  await assert.rejects(actor.get_done(),/E_ACTOR_REPLY_PROTOCOL/);
  assert.equal(actor.state,'failed');
});

test('a stuck receive times out without blocking the parent event loop', async () => {
  const worker=new FakeActorWorker({hold_reply:true});
  const actor=new ActorSession(worker,0,new Uint8Array(),{timeout_ms:35});
  actor.admit(7n);
  let ticks=0;
  queueMicrotask(()=>ticks++);
  await assert.rejects(actor.drain_and_close(),/E_ACTOR_TIMEOUT/);
  assert.ok(ticks>0,'the parent event loop remained runnable');
  assert.equal(actor.state,'failed');
  assert.equal(worker.terminated,1);
});

test('wrong actor identity or protocol on ready fails before any message', async () => {
  for (const corruption of [
    {actorId:99,version:ACTOR_PROTOCOL_VERSION},
    {actorId:0,version:ACTOR_PROTOCOL_VERSION+1}
  ]) {
    const worker=new FakeActorWorker({hold_ready:true});
    const actor=new ActorSession(worker,0,new Uint8Array());
    worker.emit({kind:'ready',...corruption});
    await assert.rejects(actor.get_done(),/E_ACTOR_PROTOCOL/);
    assert.equal(actor.state,'failed');
    assert.equal(worker.messages.filter(x=>x.kind==='message').length,0);
  }
});

test('stale or replayed reply cannot satisfy the next pending receive', async () => {
  const worker=new FakeActorWorker({hold_reply:true});
  const actor=new ActorSession(worker,1,new Uint8Array());
  actor.admit(41n);
  actor.admit(42n);
  const draining=actor.drain_and_close();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(actor.pending?.seq,1);
  worker.emit({kind:'reply',actorId:1,seq:1,value:42n});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(actor.pending?.seq,2);
  worker.emit({kind:'reply',actorId:1,seq:1,value:42n});
  await assert.rejects(draining,/E_ACTOR_REPLY_PROTOCOL/);
  await assert.rejects(actor.get_done(),/E_ACTOR_REPLY_PROTOCOL/);
  assert.equal(actor.state,'failed');
  assert.equal(worker.messages.filter(x=>x.kind==='close').length,0);
});

test('cancellation after ready but before drain continuation cannot resurrect actor', async () => {
  const worker=new FakeActorWorker({hold_ready:true});
  const actor=new ActorSession(worker,0,new Uint8Array());
  actor.admit(7n);
  const draining=actor.drain_and_close();
  worker.emit({kind:'ready',actorId:0,version:ACTOR_PROTOCOL_VERSION});
  actor.cancel();
  await assert.rejects(draining,/E_ACTOR_CANCELLED/);
  assert.equal(actor.state,'cancelled');
  assert.deepEqual(worker.messages.map(x=>x.kind),['init']);
});

test('reply callback cancellation cannot transition failed actor to closing', async () => {
  const worker=new FakeActorWorker();
  const actor=new ActorSession(worker,2,new Uint8Array());
  actor.admit(7n);
  actor.admit(8n);
  const draining=actor.drain_and_close(()=>actor.cancel());
  await assert.rejects(draining,/E_ACTOR_CANCELLED/);
  await assert.rejects(actor.get_done(),/E_ACTOR_CANCELLED/);
  assert.equal(actor.state,'cancelled');
  assert.deepEqual(worker.messages.map(x=>x.kind),['init','message']);
});

test('wrong actor identity and bogus close acknowledgement cannot report completion', async () => {
  const worker=new FakeActorWorker({hold_done:true});
  const actor=new ActorSession(worker,1,new Uint8Array());
  actor.admit(5n);
  const draining=actor.drain_and_close();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(actor.state,'closing');
  worker.emit({kind:'done',actorId:2,version:ACTOR_PROTOCOL_VERSION,processed:1,lastSeq:1});
  await assert.rejects(draining,/E_ACTOR_DONE_PROTOCOL/);
  assert.equal(actor.state,'failed');
});

test('duplicate ready after startup is a terminal protocol fault', async () => {
  const worker=new FakeActorWorker();
  const actor=new ActorSession(worker,0,new Uint8Array());
  await new Promise(resolve=>setImmediate(resolve));
  worker.emit({kind:'ready',actorId:0,version:ACTOR_PROTOCOL_VERSION});
  await assert.rejects(actor.get_done(),/E_ACTOR_PROTOCOL/);
  assert.equal(actor.state,'failed');
});
