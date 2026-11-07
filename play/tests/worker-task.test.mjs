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
test('invalid deadline rejected before worker allocation', () => {
  const { task, workers } = harness();
  for (const value of [0, -1, NaN, Infinity]) {
    assert.throws(() => task.request('./worker.js', {}, value), RangeError);
  }
  assert.equal(workers.length, 0);
});
