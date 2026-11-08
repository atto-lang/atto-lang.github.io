import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkerTask } from '../src/worker-task.js';

class FakeWorker {
  static instances = [];
  constructor(url, options) {
    this.url = url;
    this.options = options;
    this.terminated = 0;
    FakeWorker.instances.push(this);
  }
  postMessage(payload) {
    this.payload = payload;
    if (payload?.throwOnSend) throw new Error('DataCloneError');
  }
  terminate() { this.terminated++; }
  reply(data) { this.onmessage?.({ data }); }
  fail() { this.onerror?.(); }
  failDecode() { this.onmessageerror?.(); }
}
function harness() {
  FakeWorker.instances = [];
  return { task: createWorkerTask({ WorkerImpl: FakeWorker }), workers: FakeWorker.instances };
}
test('worker success settles and releases resources exactly once', async () => {
  const { task, workers } = harness();
  const promise = task.request('./worker.js', { source: '42' }, 1000);
  assert.equal(workers.length, 1);
  assert.equal(workers[0].options.type, 'module');
  workers[0].reply({ ok: true, value: 42 });
  assert.deepEqual(await promise, { ok: true, value: 42 });
  assert.equal(workers[0].terminated, 1);
  assert.equal(task.cancel(), false);
  workers[0].reply({ ok: false });
  assert.equal(workers[0].terminated, 1);
});
test('Stop rejects immediately and stale messages cannot affect the next run', async () => {
  const { task, workers } = harness();
  const first = task.request('./compiler-worker.js', { source: 'long job' }, 1000);
  const oldWorker = workers[0];
  const staleCallback = oldWorker.onmessage;
  assert.equal(task.cancel(), true);
  await assert.rejects(first, /Operation cancelled/);
  assert.equal(oldWorker.terminated, 1);
  const second = task.request('./compiler-worker.js', { source: 'new job' }, 1000);
  staleCallback({ data: { ok: true, value: -1 } });
  assert.equal(workers[1].terminated, 0);
  workers[1].reply({ ok: true, value: 42 });
  assert.deepEqual(await second, { ok: true, value: 42 });
  assert.equal(workers[1].terminated, 1);
});
test('a concurrent request is forbidden and does not replace the live worker', async () => {
  const { task, workers } = harness();
  const first = task.request('./worker.js', {}, 1000);
  assert.throws(() => task.request('./worker.js', {}, 1000), /already active/);
  assert.equal(workers.length, 1);
  task.cancel();
  await assert.rejects(first, /cancelled/);
});
test('worker execution and message decoding errors reject and terminate', async () => {
  for (const [event, expected] of [['fail', /failed to load/], ['failDecode', /decoded/]]) {
    const { task, workers } = harness();
    const promise = task.request('./worker.js', {}, 1000);
    workers[0][event]();
    await assert.rejects(promise, expected);
    assert.equal(workers[0].terminated, 1);
  }
});
test('invalid payload / structured clone failure rejects with cleanup', async () => {
  const { task, workers } = harness();
  await assert.rejects(task.request('./worker.js', { throwOnSend: true }, 1000), /DataCloneError/);
  assert.equal(workers[0].terminated, 1);
  assert.equal(task.cancel(), false);
});
test('deadline terminates the worker and rejects once', async () => {
  const { task, workers } = harness();
  await assert.rejects(task.request('./worker.js', {}, 5), /deadline exceeded/);
  assert.equal(workers[0].terminated, 1);
  assert.equal(task.cancel(), false);
});
test('deadline error names the phase that timed out', async () => {
  const { task } = harness();
  await assert.rejects(task.request('./worker.js', {}, 5, 'Compilation'), /^Error: Compilation deadline exceeded$/);
});

test('invalid deadline rejected before worker allocation', () => {
  const { task, workers } = harness();
  for (const value of [0, -1, NaN, Infinity]) {
    assert.throws(() => task.request('./worker.js', {}, value), RangeError);
  }
  assert.equal(workers.length, 0);
});


test('termination exceptions cannot strand a successful or cancelled request',async()=>{
  for(const signal of ['reply','cancel','timeout']){
    const old=[];
    let tick;
    class BadTerminationWorker extends FakeWorker {
      terminate(){this.terminated++;throw new Error('terminate denied');}
    }
    const task=createWorkerTask({WorkerImpl:BadTerminationWorker,
      setTimer:cb=>{tick=cb;return 1},
      clearTimer:id=>old.push(id)});
    const pending=task.request('./runner-worker.js',{wasm:new Uint8Array()},12000,'Execution');
    const worker=FakeWorker.instances.at(-1);
    if(signal==='reply'){
      worker.reply({ok:true,value:'42'});
      assert.deepEqual(await pending,{ok:true,value:'42'});
    } else if(signal==='cancel') {
      assert.equal(task.cancel(),true);
      await assert.rejects(pending,/Operation cancelled/);
    } else {
      tick();
      await assert.rejects(pending,/Execution deadline exceeded/);
    }
    assert.equal(worker.terminated,1);
    assert.equal(task.cancel(),false);
    assert.deepEqual(old,[1]);
  }
});
test('160 hostile late-completion and cancellation races settle exactly once',async()=>{
  for(let round=0;round<160;round++){
    FakeWorker.instances=[];
    let timeout;
    const task=createWorkerTask({WorkerImpl:FakeWorker,
      setTimer:callback=>{timeout=callback;return 7},
      clearTimer:()=>{}});
    const pending=task.request('./runner-worker.js',{wasm:new Uint8Array()},12000,'Execution');
    const w=FakeWorker.instances[0],staleReply=w.onmessage,staleError=w.onerror;
    const branch=round%4;
    if(branch===0)w.reply({ok:true,value:42});
    if(branch===1)task.cancel();
    if(branch===2)timeout();
    if(branch===3)w.failDecode();
    const result=await Promise.allSettled([pending]);
    assert.equal(result.length,1);
    assert.equal(result[0].status,branch===0?'fulfilled':'rejected');
    staleReply({data:{ok:true,value:-1}});
    staleError();
    timeout();
    assert.equal(w.terminated,1,'worker must terminate exactly once on trial '+round);
    assert.equal(task.cancel(),false);
    const fresh=task.request('./runner-worker.js',{wasm:new Uint8Array()},12000,'Execution');
    const other=FakeWorker.instances[1];
    w.reply({ok:true,value:'old'});
    other.reply({ok:true,value:'fresh'});
    assert.equal((await fresh).value,'fresh','old worker escaped request generation');
    assert.equal(other.terminated,1);
  }
});


test('page-owned broker forwards actor protocol over transferred MessagePort',async()=>{
  const {MessageChannel}=await import('node:worker_threads');
  const {ActorWorkerSupervisor}=await import('../src/actor-worker-supervisor.js');
  FakeWorker.instances=[];
  const supervisor=new ActorWorkerSupervisor({WorkerImpl:FakeWorker,
    MessageChannelImpl:MessageChannel});
  const scope=supervisor.reserve(4);
  assert.equal(supervisor.stats().activeChildren,4);
  const port=scope.ports[0];
  const incoming=[];
  port.on('message',message=>incoming.push(message));
  port.postMessage({op:'post',data:{kind:'init',actorId:0,version:1}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(FakeWorker.instances[0].payload,
    {kind:'init',actorId:0,version:1});
  FakeWorker.instances[0].reply({kind:'ready',actorId:0,version:1});
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(incoming,[{op:'event',data:{kind:'ready',actorId:0,version:1}}]);
  port.postMessage({op:'post',data:{kind:'message',actorId:0,seq:1,value:41n}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(supervisor.stats().dispatched,1);
  scope.close();
  scope.close();
  assert.deepEqual(supervisor.stats(),{
    activeChildren:0,created:4,terminated:4,uncertain:0,
    dispatched:1,ready:1,maxActive:4
  });
  assert.ok(FakeWorker.instances.every(w=>w.terminated===1));
});

test('128 independent four-actor parent Stop/deadline/error/response trials leave no leased handles',async()=>{
  const {MessageChannel}=await import('node:worker_threads');
  const {ActorWorkerSupervisor}=await import('../src/actor-worker-supervisor.js');
  FakeWorker.instances=[];
  const owner=new ActorWorkerSupervisor({WorkerImpl:FakeWorker,
    MessageChannelImpl:MessageChannel});
  let timeout;
  const task=createWorkerTask({WorkerImpl:FakeWorker,
    MessageChannelImpl:MessageChannel,supervisor:owner,
    setTimer:cb=>{timeout=cb;return 9},clearTimer:()=>{}});
  for(let n=0;n<128;n++){
    const pending=task.request('./runner-worker.js',
      {wasm:new Uint8Array([0,97,115,109,1,0,0,0])},
      12000,'Execution',{actorSlots:4});
    const parent=FakeWorker.instances.at(-1),snapshot=parent.onmessage;
    const terminal=pending.then(x=>({ok:true,data:x}),e=>({ok:false,error:e.message}));
    if(n%4===0)task.cancel();
    else if(n%4===1)timeout();
    else if(n%4===2)parent.fail();
    else parent.reply({ok:true,value:'42'});
    const result=await terminal;
    assert.equal(result.ok,n%4===3);
    assert.equal(task.actorStats().activeChildren,0,'leak in trial '+n);
    assert.equal(task.actorStats().created,4*(n+1));
    assert.equal(task.actorStats().terminated,4*(n+1));
    assert.equal(task.actorStats().uncertain,0);
    snapshot({data:{ok:true,value:'stale'}});
    timeout();
    assert.equal(task.cancel(),false);
    assert.equal(parent.terminated,1);
  }
  assert.equal(task.actorStats().maxActive,4);
});


test('child constructor failures at positions 1 through 4 roll back all prior leases',async()=>{
  const {MessageChannel}=await import('node:worker_threads');
  const {ActorWorkerSupervisor}=await import('../src/actor-worker-supervisor.js');
  for(let failAt=1;failAt<=4;failAt++){
    FakeWorker.instances=[];
    let spawned=0;
    class FailingWorker extends FakeWorker {
      constructor(...args) {
        if(++spawned===failAt)throw new Error('E_INJECT_CHILD_CONSTRUCTION');
        super(...args);
      }
    }
    const owner=new ActorWorkerSupervisor({
      WorkerImpl:FailingWorker,MessageChannelImpl:MessageChannel
    });
    assert.throws(()=>owner.reserve(4),/E_INJECT_CHILD_CONSTRUCTION/);
    const stats=owner.stats();
    assert.equal(stats.activeChildren,0,'lease leaked after constructor '+failAt);
    assert.equal(stats.created,failAt-1);
    assert.equal(stats.terminated,failAt-1);
    assert.equal(stats.uncertain,0);
    assert.ok(FakeWorker.instances.every(w=>w.terminated===1));
    // A partially allocated scope must not hold the busy lock.
    const usable=new ActorWorkerSupervisor({
      WorkerImpl:FakeWorker,MessageChannelImpl:MessageChannel
    });
    const fresh=usable.reserve(4);fresh.close();
    assert.equal(usable.stats().activeChildren,0);
  }
});
test('channel allocation failures account for even the unregistered child',async()=>{
  const {MessageChannel}=await import('node:worker_threads');
  const {ActorWorkerSupervisor}=await import('../src/actor-worker-supervisor.js');
  for(let failAt=1;failAt<=4;failAt++){
    FakeWorker.instances=[];
    let channels=0;
    class FailingChannel {
      constructor(){
        if(++channels===failAt)throw new Error('E_INJECT_CHANNEL_CONSTRUCTION');
        return new MessageChannel();
      }
    }
    const owner=new ActorWorkerSupervisor({
      WorkerImpl:FakeWorker,MessageChannelImpl:FailingChannel
    });
    assert.throws(()=>owner.reserve(4),/E_INJECT_CHANNEL_CONSTRUCTION/);
    const stats=owner.stats();
    assert.equal(stats.activeChildren,0);
    assert.equal(stats.created,failAt);
    assert.equal(stats.terminated,failAt);
    assert.equal(stats.uncertain,0);
    assert.ok(FakeWorker.instances.every(w=>w.terminated===1));
  }
});
test('parent constructor or transfer failures revoke four page-owned children',async()=>{
  const {MessageChannel}=await import('node:worker_threads');
  const {ActorWorkerSupervisor}=await import('../src/actor-worker-supervisor.js');
  for(const mode of ['constructor','transfer']){
    FakeWorker.instances=[];
    class HostileWorker extends FakeWorker {
      constructor(url,options){
        if(mode==='constructor'&&String(url).includes('runner-worker'))
          throw new Error('E_PARENT_CONSTRUCTION');
        super(url,options);
      }
      postMessage(payload,ports){
        if(mode==='transfer'&&ports?.length)
          throw new Error('DataCloneError: E_PORT_TRANSFER');
        return super.postMessage(payload);
      }
    }
    const owner=new ActorWorkerSupervisor({
      WorkerImpl:HostileWorker,MessageChannelImpl:MessageChannel
    });
    const task=createWorkerTask({
      WorkerImpl:HostileWorker,MessageChannelImpl:MessageChannel,
      supervisor:owner
    });
    const pending=task.request('./runner-worker.js',{wasm:new Uint8Array()},
      1000,'Execution',{actorSlots:4});
    await assert.rejects(pending,mode==='constructor'
      ?/E_PARENT_CONSTRUCTION/:/E_PORT_TRANSFER/);
    assert.equal(task.cancel(),false);
    assert.equal(owner.stats().activeChildren,0);
    assert.equal(owner.stats().created,4);
    assert.equal(owner.stats().terminated,4);
    assert.equal(owner.stats().uncertain,0);
    assert.ok(FakeWorker.instances.every(w=>w.terminated===1));
    const usable=task.request('./regular-worker.js',{source:'clean'},1000);
    FakeWorker.instances.at(-1).reply({ok:true,value:'recovered'});
    assert.deepEqual(await usable,{ok:true,value:'recovered'});
  }
});
test('timer setup, event handler setup and synchronous timeout cannot leave active child leases',async()=>{
  const {MessageChannel}=await import('node:worker_threads');
  const {ActorWorkerSupervisor}=await import('../src/actor-worker-supervisor.js');
  for(const mode of ['timer-throws','handler-throws','immediate-timeout']){
    FakeWorker.instances=[];
    class HostileWorker extends FakeWorker {
      constructor(...args){
        super(...args);
        if(mode==='handler-throws'&&String(args[0]).includes('runner-worker'))
          Object.defineProperty(this,'onmessage',{set(){throw Error('E_HANDLER_BIND')}});
      }
    }
    const owner=new ActorWorkerSupervisor({
      WorkerImpl:HostileWorker,MessageChannelImpl:MessageChannel
    });
    const task=createWorkerTask({
      WorkerImpl:HostileWorker,MessageChannelImpl:MessageChannel,
      supervisor:owner,
      setTimer:cb=>{
        if(mode==='timer-throws')throw Error('E_TIMER_SETUP');
        if(mode==='immediate-timeout')cb();
        return 1;
      },
      clearTimer:()=>{if(mode==='timer-throws')throw Error('E_TIMER_CLEAR');}
    });
    const pending=task.request('./runner-worker.js',{wasm:new Uint8Array()},
      1000,'Execution',{actorSlots:4});
    await assert.rejects(pending,mode==='timer-throws'?/E_TIMER_SETUP/
      :mode==='handler-throws'?/E_HANDLER_BIND/:/Execution deadline exceeded/);
    const stats=owner.stats();
    assert.equal(stats.activeChildren,0,mode);
    assert.equal(stats.created,4,mode);
    assert.equal(stats.terminated,4,mode);
    assert.equal(stats.uncertain,0,mode);
    assert.equal(task.cancel(),false);
    assert.ok(FakeWorker.instances.every(w=>w.terminated===1));
  }
});
test('256 supervised Stop/timeout/last-response races have exact single settlement',async()=>{
  const {MessageChannel}=await import('node:worker_threads');
  const {ActorWorkerSupervisor}=await import('../src/actor-worker-supervisor.js');
  FakeWorker.instances=[];
  const owner=new ActorWorkerSupervisor({
    WorkerImpl:FakeWorker,MessageChannelImpl:MessageChannel
  });
  let tick;
  const task=createWorkerTask({
    WorkerImpl:FakeWorker,MessageChannelImpl:MessageChannel,supervisor:owner,
    setTimer:cb=>{tick=cb;return 12},clearTimer:()=>{}
  });
  for(let n=0;n<256;n++){
    const promise=task.request('./runner-worker.js',
      {wasm:new Uint8Array()},2000,'Execution',{actorSlots:4});
    const parent=FakeWorker.instances.at(-1);
    const staleReply=parent.onmessage,staleError=parent.onerror;
    let settled=0;
    const result=promise.then(value=>{settled++;return {ok:true,value};},
      error=>{settled++;return {ok:false,message:error.message};});
    if(n%4===0){task.cancel();tick();staleReply({data:{ok:true}});}
    else if(n%4===1){tick();task.cancel();staleReply({data:{ok:true}});}
    else if(n%4===2){parent.reply({ok:true,value:'42'});task.cancel();tick();}
    else {parent.fail();tick();task.cancel();}
    const got=await result;
    assert.equal(got.ok,n%4===2);
    assert.equal(settled,1,'multiple terminal settlements in race '+n);
    staleReply({data:{ok:true,value:'late'}});
    staleError();
    tick();
    assert.equal(settled,1,'late stale callback settled race '+n);
    assert.equal(owner.stats().activeChildren,0);
    assert.equal(owner.stats().created,(n+1)*4);
    assert.equal(owner.stats().terminated,(n+1)*4);
    assert.equal(owner.stats().uncertain,0);
    assert.equal(parent.terminated,1);
    assert.equal(task.cancel(),false);
  }
});


test('uncertain child termination fails closed and permanently quarantines actor scope',async()=>{
  const {MessageChannel}=await import('node:worker_threads');
  const {ActorWorkerSupervisor}=await import('../src/actor-worker-supervisor.js');
  FakeWorker.instances=[];
  class BadChildTermination extends FakeWorker {
    terminate(){
      this.terminated++;
      if(String(this.url).includes('actor-guest-worker'))
        throw Error('E_INJECT_TERMINATE_EXCEPTION');
    }
  }
  const owner=new ActorWorkerSupervisor({
    WorkerImpl:BadChildTermination,MessageChannelImpl:MessageChannel
  });
  const task=createWorkerTask({
    WorkerImpl:BadChildTermination,MessageChannelImpl:MessageChannel,
    supervisor:owner
  });
  const pending=task.request('./runner-worker.js',{wasm:new Uint8Array()},
    1000,'Execution',{actorSlots:4});
  FakeWorker.instances.at(-1).reply({ok:true,value:'42'});
  await assert.rejects(pending,/E_ACTOR_SUPERVISOR_UNCERTAIN/);
  assert.deepEqual(owner.stats(),{
    activeChildren:0,created:4,terminated:4,uncertain:4,
    dispatched:0,ready:0,maxActive:4
  });
  assert.equal(task.cancel(),false);
  await assert.rejects(task.request('./runner-worker.js',{wasm:new Uint8Array()},
    1000,'Execution',{actorSlots:4}),/E_ACTOR_SUPERVISOR_UNCERTAIN/);
  assert.equal(owner.stats().created,4,'tainted supervisor allocated more actors');
  // Non-actor compiler tasks do not share an actor resource scope.
  const compile=task.request('./compiler-worker.js',{source:'return 42'},1000);
  FakeWorker.instances.at(-1).reply({ok:true,value:'unaffected'});
  assert.deepEqual(await compile,{ok:true,value:'unaffected'});
});
