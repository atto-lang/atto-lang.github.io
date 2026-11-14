import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { runTenantWasm } from '../node/tenant-vm.mjs';

// These are host transport/termination negative cases, not guest parity.
// The real compiler-backed multi-actor guest tests remain in tenant-node.test.mjs.
const guest = () => new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);

function controlled({ postFailure = false, termination = 'manual' } = {}) {
  const workers = [];
  class ControlledWorker extends EventEmitter {
    constructor() {
      super();
      this.terminationCalls = 0;
      workers.push(this);
    }
    postMessage(frame) {
      if (postFailure) throw new Error('synthetic postMessage failure');
      this.frame = frame;
    }
    terminate() {
      this.terminationCalls++;
      if (termination === 'throws') throw new Error('synthetic terminate failure');
      if (termination === 'missing') return undefined;
      if (termination === 'rejects') return Promise.reject(new Error('synthetic terminate rejection'));
      return new Promise((resolve, reject) => {
        this.confirmExit = resolve;
        this.rejectExit = reject;
      });
    }
  }
  return {
    workers,
    run: (wasm = guest(), timeoutMs = 3000) => runTenantWasm({
      tenantId: 'tenantA', wasm, timeoutMs, WorkerImpl: ControlledWorker
    })
  };
}

async function remainsPending(promise) {
  const state = await Promise.race([
    promise.then(() => 'resolved', () => 'rejected'),
    nextTurn().then(() => 'pending')
  ]);
  assert.equal(state, 'pending', 'must not settle before physical Worker termination');
}

test('successful TenantVM result is held until Worker termination receipt', async () => {
  const { run, workers } = controlled();
  const bytes = guest();
  const work = run(bytes);
  const worker = workers[0];
  bytes[0] = 99;
  assert.equal(worker.frame.wasm[0], 0, 'validated input is snapshotted');
  const reply = { ok: true, value: '42', stdout: '', truncated: false, actors: 0 };
  worker.emit('message', reply);
  assert.equal(worker.terminationCalls, 1);
  await remainsPending(work);
  worker.confirmExit(0);
  assert.deepEqual(await work, reply);
});

test('synchronous postMessage exception requires termination before rejection', async () => {
  const { run, workers } = controlled({ postFailure: true });
  const work = run();
  assert.equal(workers[0].terminationCalls, 1);
  await remainsPending(work);
  workers[0].confirmExit(0);
  await assert.rejects(work, /synthetic postMessage failure/);
});

test('deadline does not reclaim tenant before confirmed Worker termination', async () => {
  const { run, workers } = controlled();
  const work = run(guest(), 10);
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(workers[0].terminationCalls, 1);
  await remainsPending(work);
  workers[0].confirmExit(1);
  await assert.rejects(work, /deadline/);
});

for (const termination of ['throws', 'missing', 'rejects']) {
  test(`unconfirmed termination fails closed (${termination})`, async () => {
    const { run, workers } = controlled({ termination });
    const work = run();
    workers[0].emit('message', { ok: true });
    await assert.rejects(work, /E_TENANT_TERMINATION/);
    assert.equal(workers[0].terminationCalls, 1);
  });
}

test('unexpected Worker exit rejects without claiming a successful guest reply', async () => {
  const { run, workers } = controlled();
  const work = run();
  workers[0].emit('exit', 7);
  await assert.rejects(work, /E_TENANT_EXIT: worker exited before replying \(code 7\)/);
  assert.equal(workers[0].terminationCalls, 0);
});

test('malformed, oversized and forged disposable Worker replies fail closed until retirement', async () => {
  const valid = { ok: true, value: '42', stdout: '', truncated: false, actors: 0 };
  const malformed = [
    null, {}, { ...valid, ok: 'true' },
    { ...valid, value: undefined }, { ...valid, value: '42.0' },
    { ...valid, value: '0042' },
    { ...valid, value: '9223372036854775808' },
    { ...valid, value: '-9223372036854775809' },
    { ...valid, stdout: 'x'.repeat(64 * 1024 + 1) },
    { ...valid, truncated: 'false' },
    { ...valid, actors: -1 }, { ...valid, actors: 17 },
    { ok: false, message: '', stdout: '', truncated: false, actors: 0 }
  ];
  for (const reply of malformed) {
    const { run, workers } = controlled();
    const work = run();
    workers[0].emit('message', reply);
    assert.equal(workers[0].terminationCalls, 1, 'malformed frame must retire Worker');
    await remainsPending(work);
    workers[0].confirmExit(0);
    await assert.rejects(work, /E_TENANT_PROTOCOL: invalid disposable Worker reply/);
  }
});

test('valid negative guest result is returned only after Worker retirement', async () => {
  const { run, workers } = controlled();
  const work = run();
  const reply = {
    ok: false, message: 'E_RUNTIME: guest rejected', stdout: '',
    truncated: false, actors: 0
  };
  workers[0].emit('message', reply);
  await remainsPending(work);
  workers[0].confirmExit(0);
  assert.deepEqual(await work, reply);
});

test('disposable tenant validates its owned snapshot, not a caller buffer mutated during validation', async () => {
  const { run, workers } = controlled();
  const callerBuffer = guest();
  const actualValidate = WebAssembly.validate;
  let validated = null, work;
  try {
    WebAssembly.validate = input => {
      validated = input;
      const accepted = actualValidate(input);
      callerBuffer[0] = 255; // deterministic stand-in for concurrent mutation
      return accepted;
    };
    work = run(callerBuffer);
  } finally {
    WebAssembly.validate = actualValidate;
  }
  assert.notStrictEqual(validated, callerBuffer);
  assert.equal(callerBuffer[0], 255);
  assert.equal(workers[0].frame.wasm[0], 0,
    'transferred bytes must be exactly the validated snapshot');
  workers[0].emit('message', { ok: true, value: '0', stdout: '', truncated: false, actors: 0 });
  workers[0].confirmExit(0);
  assert.equal((await work).value, '0');
});
