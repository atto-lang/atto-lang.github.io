import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { createNodeTenantRunner } from '../src/node-tenant-runner.mjs';

// Transport-only negative tests. Real guest execution remains covered by
// node-tenant-runner.test.mjs and Chromium E2E. No fake guest is used as parity.
function controlled({ postFails = false, termination = 'manual' } = {}) {
  const workers = [];
  class ControlledWorker extends EventEmitter {
    constructor() {
      super();
      this.terminationCalls = 0;
      workers.push(this);
    }
    postMessage(frame) {
      if (postFails) throw new Error('synthetic clone failure');
      this.frame = frame;
    }
    terminate() {
      this.terminationCalls++;
      if (termination === 'throws') throw new Error('synthetic termination throw');
      if (termination === 'missing') return undefined;
      if (termination === 'rejects') return Promise.reject(new Error('synthetic termination rejection'));
      return new Promise((resolve, reject) => {
        this.confirmTermination = resolve;
        this.rejectTermination = reject;
      });
    }
  }
  return { run: createNodeTenantRunner(ControlledWorker), workers };
}

const bytes = () => new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
async function assertPending(promise) {
  const state = await Promise.race([
    promise.then(() => 'resolved', () => 'rejected'),
    nextTurn().then(() => 'pending')
  ]);
  assert.equal(state, 'pending', 'caller must not settle before physical Worker termination');
}

test('successful guest reply waits for termination and input bytes are snapshotted', async () => {
  const { run, workers } = controlled();
  const input = bytes();
  const operation = run(input, { deadline_ms: 3000 });
  const worker = workers[0];
  input[0] = 99;
  assert.equal(worker.frame.wasm[0], 0, 'caller mutation must not change admitted guest bytes');
  worker.emit('message', { ok: true, value: '42' });
  assert.equal(worker.terminationCalls, 1);
  await assertPending(operation);
  worker.confirmTermination(0);
  assert.deepEqual(await operation, { ok: true, value: '42' });
});

test('postMessage clone failure still terminates and waits for receipt', async () => {
  const { run, workers } = controlled({ postFails: true });
  const operation = run(bytes(), { deadline_ms: 3000 });
  assert.equal(workers[0].terminationCalls, 1);
  await assertPending(operation);
  workers[0].confirmTermination(0);
  await assert.rejects(operation, /synthetic clone failure/);
});

test('tenant timeout does not release caller before termination confirmation', async () => {
  const { run, workers } = controlled();
  const operation = run(bytes(), { deadline_ms: 10 });
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(workers[0].terminationCalls, 1);
  await assertPending(operation);
  workers[0].confirmTermination(1);
  await assert.rejects(operation, /E_TENANT_TIMEOUT/);
});

for (const mode of ['throws', 'missing', 'rejects']) {
  test(`unconfirmed Worker termination fails closed: ${mode}`, async () => {
    const { run, workers } = controlled({ termination: mode });
    const operation = run(bytes(), { deadline_ms: 3000 });
    workers[0].emit('message', { ok: true });
    await assert.rejects(operation, /E_TENANT_TERMINATION/);
    assert.equal(workers[0].terminationCalls, 1);
  });
}

test('unexpected worker exit is an error but does not require a second termination', async () => {
  const { run, workers } = controlled();
  const operation = run(bytes(), { deadline_ms: 3000 });
  workers[0].emit('exit', 9);
  await assert.rejects(operation, /E_TENANT_EXIT: worker exited \(9\)/);
  assert.equal(workers[0].terminationCalls, 0);
});
