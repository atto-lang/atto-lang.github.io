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
