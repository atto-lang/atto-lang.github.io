import test from 'node:test';
import assert from 'node:assert/strict';
import { MessageChannel } from 'node:worker_threads';
import { ActorWorkerBroker, MAX_SUPERVISED_ACTORS } from '../src/actor-worker-broker.js';
import { actorWorkerPortFactory } from '../src/actor-worker-port.js';
import { createWorkerTask } from '../src/worker-task.js';

class FakeActor {
  static instances = [];
  constructor() {
    this.messages = [];
    this.terminated = 0;
    FakeActor.instances.push(this);
  }
  postMessage(data) {
    this.messages.push(data);
    if (data?.kind === 'init')
      queueMicrotask(() => this.onmessage?.({data:{kind:'ready'}}));
    if (data?.kind === 'mail')
      queueMicrotask(() => this.onmessage?.({data:{kind:'done',sequence:data.sequence}}));
  }
  terminate() { this.terminated++; }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(predicate, description='event') {
  for (let i=0; i<90; i++) {
    if (predicate()) return;
    await sleep(3);
  }
  throw Error('timed out: ' + description);
}
function harness(WorkerImpl=FakeActor) {
  FakeActor.instances=[];
  const broker=new ActorWorkerBroker({WorkerImpl,MessageChannelImpl:MessageChannel});
  return {broker,scope:broker.reserve()};
}

test('broker creates no idle actors; v2 init and FIFO mail traverse separate children',async()=>{
  const {broker,scope}=harness();
  assert.equal(broker.stats().created,0,'actor workers must be on-demand');
  const Proxy=actorWorkerPortFactory(scope.port);
  const a=new Proxy(), b=new Proxy();
  const aEvents=[],bEvents=[];
  a.onmessage=event=>aEvents.push(event.data);
  b.onmessage=event=>bEvents.push(event.data);
  a.postMessage({kind:'init',wasm:new Uint8Array([0]),type:0});
  b.postMessage({kind:'init',wasm:new Uint8Array([0]),type:0});
  a.postMessage({kind:'mail',sequence:0,value:40n});
  a.postMessage({kind:'mail',sequence:1,value:2n});
  b.postMessage({kind:'mail',sequence:0,value:7n});
  await until(()=>aEvents.length===3&&bEvents.length===2,'both actor streams');
  assert.deepEqual(aEvents.map(e=>e.kind),['ready','done','done']);
  assert.deepEqual(aEvents.slice(1).map(e=>e.sequence),[0,1]);
  assert.deepEqual(bEvents.map(e=>e.kind),['ready','done']);
  assert.equal(broker.stats().created,2);
  assert.equal(broker.stats().dispatched,3);
  assert.equal(broker.stats().ready,2);
  assert.equal(broker.stats().activeChildren,2);
  scope.close();scope.close();
  assert.equal(broker.stats().activeChildren,0);
  assert.equal(broker.stats().created,broker.stats().terminated);
  assert.ok(FakeActor.instances.every(w=>w.terminated===1));
});

test('v2 broker admits 16 actors but rejects a seventeenth without allocations',async()=>{
  const {broker,scope}=harness();
  const Proxy=actorWorkerPortFactory(scope.port);
  const actors=Array.from({length:MAX_SUPERVISED_ACTORS},()=>new Proxy());
  await until(()=>broker.stats().created===MAX_SUPERVISED_ACTORS);
  assert.throws(()=>new Proxy(),/E_ACTOR_LIMIT/);
  assert.equal(broker.stats().maxActive,MAX_SUPERVISED_ACTORS);
  actors.forEach(a=>a.terminate());
  await until(()=>broker.stats().activeChildren===0);
  scope.close();
  assert.equal(broker.stats().terminated,MAX_SUPERVISED_ACTORS);
});

test('broker rejects forged duplicate spawn and does not allocate an extra worker',async()=>{
  const {broker,scope}=harness();
  const Proxy=actorWorkerPortFactory(scope.port);
  const actor=new Proxy();
  await until(()=>broker.stats().created===1);
  scope.port.postMessage({op:'spawn',id:0});
  await sleep(15);
  assert.equal(broker.stats().created,1);
  actor.terminate();
  await until(()=>broker.stats().activeChildren===0);
  scope.close();
});

test('child postMessage clone fault revokes exactly one worker without counting mail',async()=>{
  class CloneFault extends FakeActor {
    postMessage(data) {
      if (data.kind==='mail') throw Error('DataCloneError');
      return super.postMessage(data);
    }
  }
  const {broker,scope}=harness(CloneFault);
  const Proxy=actorWorkerPortFactory(scope.port);
  const actor=new Proxy();
  let fault=0;
  actor.onerror=()=>fault++;
  actor.postMessage({kind:'init',wasm:new Uint8Array(),type:0});
  actor.postMessage({kind:'mail',sequence:0,value:1n});
  await until(()=>fault===1,'clone fault');
  assert.equal(broker.stats().dispatched,0);
  assert.equal(broker.stats().created,broker.stats().terminated);
  assert.equal(broker.stats().activeChildren,0);
  scope.close();
});

test('child constructor failure reports error and permits a future healthy generation',async()=>{
  let attempts=0;
  class OnceBad extends FakeActor {
    constructor(){
      if(++attempts===1)throw Error('E_INJECT_CHILD_CREATE');
      super();
    }
  }
  const broker=new ActorWorkerBroker({WorkerImpl:OnceBad,MessageChannelImpl:MessageChannel});
  let scope=broker.reserve(), Proxy=actorWorkerPortFactory(scope.port);
  const actor=new Proxy();let faults=0;
  actor.onerror=()=>faults++;
  await until(()=>faults===1,'constructor failure');
  assert.equal(broker.stats().created,0);
  scope.close();
  scope=broker.reserve();Proxy=actorWorkerPortFactory(scope.port);
  const ok=new Proxy();
  await until(()=>broker.stats().created===1,'recovery child');
  ok.terminate();scope.close();
  assert.equal(broker.stats().created,broker.stats().terminated);
});

test('uncertain termination fails closed across generations',async()=>{
  class BadTerminate extends FakeActor {
    terminate(){this.terminated++;throw Error('E_INJECT_CHILD_TERMINATE');}
  }
  const {broker,scope}=harness(BadTerminate);
  const Proxy=actorWorkerPortFactory(scope.port);
  new Proxy();
  await until(()=>broker.stats().created===1);
  scope.close();
  assert.equal(broker.stats().uncertain,1);
  assert.equal(broker.stats().activeChildren,0);
  assert.throws(()=>broker.reserve(),/E_ACTOR_SUPERVISOR_UNCERTAIN/);
});

test('stale callbacks and old ports cannot reenter a new generation',async()=>{
  const {broker,scope}=harness();
  const Proxy=actorWorkerPortFactory(scope.port), a=new Proxy();
  await until(()=>broker.stats().created===1);
  const old=FakeActor.instances[0], late=old.onmessage;
  scope.close();
  const ready=broker.stats().ready;
  late({data:{kind:'ready'}});
  scope.port.postMessage({op:'spawn',id:1});
  assert.equal(broker.stats().ready,ready);
  const next=broker.reserve(), Other=actorWorkerPortFactory(next.port);
  const fresh=new Other();
  await until(()=>broker.stats().created===2);
  assert.equal(broker.stats().activeChildren,1);
  fresh.terminate();
  next.close();
  assert.equal(broker.stats().created,broker.stats().terminated);
});

test('128 repeated generation stops reclaim all page-owned handles',async()=>{
  const {broker,scope}=harness();
  scope.close();
  for(let gen=0;gen<128;gen++){
    const current=broker.reserve();
    const Proxy=actorWorkerPortFactory(current.port);
    new Proxy();new Proxy();new Proxy();new Proxy();
    await until(()=>broker.stats().activeChildren===4,'generation '+gen);
    current.close();
    assert.equal(broker.stats().activeChildren,0);
    assert.equal(broker.stats().created,(gen+1)*4);
    assert.equal(broker.stats().terminated,(gen+1)*4);
    assert.equal(broker.stats().uncertain,0);
  }
  assert.equal(broker.stats().maxActive,4);
});

test('parent transfer failure, termination exception and immediate deadlines settle safely',async()=>{
  class FakeParent {
    static instances=[];
    constructor(){this.terminated=0;FakeParent.instances.push(this);}
    postMessage(_payload,ports){if(ports?.length && this.failTransfer)throw Error('DataCloneError');}
    terminate(){this.terminated++;if(this.failStop)throw Error('terminate failed');}
    reply(data){this.onmessage?.({data});}
  }
  let broker=new ActorWorkerBroker({WorkerImpl:FakeActor,MessageChannelImpl:MessageChannel});
  let task=createWorkerTask({WorkerImpl:FakeParent,broker,MessageChannelImpl:MessageChannel});
  const normal=task.request('runner',{wasm:new Uint8Array()},1000,'Execution',{superviseActors:true});
  const parent=FakeParent.instances.at(-1);
  parent.reply({ok:true,value:'42'});
  assert.deepEqual(await normal,{ok:true,value:'42'});
  assert.equal(broker.stats().activeChildren,0);

  class FailedTransfer extends FakeParent {
    postMessage(_payload,ports){if(ports?.length)throw Error('DataCloneError');}
  }
  broker=new ActorWorkerBroker({WorkerImpl:FakeActor,MessageChannelImpl:MessageChannel});
  task=createWorkerTask({WorkerImpl:FailedTransfer,broker,MessageChannelImpl:MessageChannel});
  await assert.rejects(task.request('runner',{},1000,'Execution',{superviseActors:true}),/DataCloneError/);
  assert.equal(broker.stats().activeChildren,0);
  assert.equal(task.cancel(),false);

  class FailedStop extends FakeParent {
    terminate(){this.terminated++;throw Error('E_PARENT_TERMINATE');}
  }
  task=createWorkerTask({WorkerImpl:FailedStop,MessageChannelImpl:MessageChannel});
  const pending=task.request('runner',{},1000,'Execution',{superviseActors:true});
  FakeParent.instances.at(-1).reply({ok:true});
  await assert.rejects(pending,/E_WORKER_TERMINATION_UNCERTAIN/);
  assert.throws(()=>task.request('runner',{},1000),/E_WORKER_TERMINATION_UNCERTAIN/);

  let timer;
  task=createWorkerTask({WorkerImpl:FakeParent,MessageChannelImpl:MessageChannel,
    setTimer:cb=>{timer=cb;cb();return 1},clearTimer:()=>{}});
  await assert.rejects(task.request('runner',{},1000,'Execution',{superviseActors:true}),/deadline exceeded/);
  assert.equal(task.actorStats().activeChildren,0);
  assert.equal(task.cancel(),false);
});
