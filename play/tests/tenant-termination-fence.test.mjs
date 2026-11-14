import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { runTenantWasm } from '../node/tenant-vm.mjs';

const EMPTY_WASM = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
const tick = () => new Promise(resolve => setImmediate(resolve));

test('tenant result is withheld until worker termination is confirmed', async () => {
  let releaseTermination;
  let terminationRequested = false;
  class DelayedWorker extends EventEmitter {
    postMessage(_message) {
      queueMicrotask(() => this.emit('message', {ok: true, value: '42'}));
    }
    terminate() {
      terminationRequested = true;
      return new Promise(resolve => { releaseTermination = resolve; });
    }
  }
  const result = runTenantWasm({
    tenantId: 'termination-barrier', wasm: EMPTY_WASM,
    WorkerImpl: DelayedWorker, timeoutMs: 1000
  });
  let settled = false;
  result.finally(() => { settled = true; });
  await tick();
  assert.equal(terminationRequested, true);
  assert.equal(settled, false, 'result must be withheld while worker still lives');
  releaseTermination(0);
  assert.deepEqual(await result, {ok: true, value: '42'});
});

test('tenant rejects a missing termination receipt rather than falsely reporting success', async () => {
  class UnconfirmedWorker extends EventEmitter {
    postMessage() { queueMicrotask(() => this.emit('message', {ok: true})); }
    terminate() { return undefined; }
  }
  await assert.rejects(runTenantWasm({
    tenantId: 'uncertain-termination', wasm: EMPTY_WASM, WorkerImpl: UnconfirmedWorker
  }), /E_TENANT_TERMINATION/);
});

test('tenant rejects a rejected termination receipt and preserves its cause', async () => {
  class RejectingWorker extends EventEmitter {
    postMessage() { queueMicrotask(() => this.emit('message', {ok: true})); }
    terminate() { return Promise.reject(new Error('termination rejected')); }
  }
  await assert.rejects(runTenantWasm({
    tenantId: 'rejected-termination', wasm: EMPTY_WASM, WorkerImpl: RejectingWorker
  }), error => error.message.includes('E_TENANT_TERMINATION') && error.cause?.message === 'termination rejected');
});

test('timeout error is emitted only after worker termination completes', async () => {
  let releaseTermination;
  let terminateCount = 0;
  class StuckWorker extends EventEmitter {
    postMessage() { /* deliberate unresponsive guest */ }
    terminate() {
      terminateCount++;
      return new Promise(resolve => { releaseTermination = resolve; });
    }
  }
  const result = runTenantWasm({
    tenantId: 'timeout-barrier', wasm: EMPTY_WASM,
    WorkerImpl: StuckWorker, timeoutMs: 10
  });
  let outcome;
  result.then(() => { outcome = 'resolved'; }, error => { outcome = error.message; });
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(terminateCount, 1);
  assert.equal(outcome, undefined);
  releaseTermination(0);
  await assert.rejects(result, /Execution deadline exceeded/);
});
