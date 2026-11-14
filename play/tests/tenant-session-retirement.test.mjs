import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { createTenantSession, createTenantRegistry } from '../node/tenant-session.mjs';

// These are hostile-host-protocol and Worker lifecycle tests only.
// Genuine compiler/Wasm multi-actor parity remains in tenant-session.test.mjs.
const wasm = () => new Uint8Array([0,97,115,109,1,0,0,0]);
function controlled({ termination = 'manual', failSend = false } = {}) {
  const workers = [];
  class ControlledWorker extends EventEmitter {
    constructor() { super(); this.terminationCalls = 0; workers.push(this); }
    postMessage(frame) {
      if (failSend && frame.op === 'send') throw new Error('synthetic transport failure');
      this.frame = frame;
    }
    terminate() {
      this.terminationCalls++;
      if (termination === 'throws') throw new Error('synthetic terminate throw');
      if (termination === 'missing') return undefined;
      if (termination === 'rejects') return Promise.reject(new Error('synthetic terminate rejection'));
      return new Promise(resolve => { this.confirmExit = resolve; });
    }
  }
  return { workers, WorkerImpl: ControlledWorker };
}
async function pending(promise) {
  const state = await Promise.race([
    promise.then(() => 'resolved', () => 'rejected'),
    nextTurn().then(() => 'pending')
  ]);
  assert.equal(state, 'pending', 'retirement receipt has not arrived');
}
async function startSession(session, worker, actors = 2) {
  const promise = session.start(wasm());
  assert.equal(worker.frame.op, 'start');
  worker.emit('message', { id: worker.frame.id, ok: true, actors, value: '42', stdout: '', truncated: false });
  return await promise;
}

test('persistent tenant registry holds ID and capacity until physical termination', async () => {
  const { workers, WorkerImpl } = controlled();
  const registry = createTenantRegistry({ maxTenants: 1, WorkerImpl });
  const session = registry.open('alpha');
  const begin = await startSession(session, workers[0]);
  assert.equal(begin.actorHandles.length, 2);
  const close = registry.close('alpha');
  assert.equal(session.closed, true);
  assert.equal(session.retired, false);
  assert.equal(registry.size, 1);
  assert.throws(() => registry.open('alpha'), /duplicate/);
  assert.throws(() => registry.open('beta'), /registry full/);
  await pending(close);
  workers[0].confirmExit(0);
  assert.equal(await close, true);
  assert.equal(session.retired, true);
  assert.equal(registry.size, 0);
  const next = registry.open('alpha');
  const closeNext = next.close();
  workers[1].confirmExit(0);
  await closeNext;
  await registry.close('alpha');
});

test('timed-out RPC rejects only after worker retirement', async () => {
  const { workers, WorkerImpl } = controlled();
  const session = createTenantSession({ tenantId: 'timeout', timeoutMs: 10, WorkerImpl });
  const opening = session.start(wasm());
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(session.closed, true);
  assert.equal(session.retired, false);
  assert.equal(workers[0].terminationCalls, 1);
  await pending(opening);
  workers[0].confirmExit(1);
  await assert.rejects(opening, /deadline/);
  assert.equal(session.retired, true);
});

test('malformed actor-count response cannot allocate fake ActorRefs', async () => {
  const { workers, WorkerImpl } = controlled();
  const session = createTenantSession({ tenantId: 'malformed', WorkerImpl });
  const opening = session.start(wasm());
  workers[0].emit('message', { id: 1, ok: true, actors: 1_000_000 });
  await pending(opening);
  assert.equal(workers[0].terminationCalls, 1);
  workers[0].confirmExit(0);
  await assert.rejects(opening, /E_TENANT_PROTOCOL/);
});

test('postMessage failure during persistent send terminates before rejecting request', async () => {
  const { workers, WorkerImpl } = controlled({ failSend: true });
  const session = createTenantSession({ tenantId: 'send', WorkerImpl });
  const started = await startSession(session, workers[0], 1);
  const result = session.send(started.actorHandles[0], 1n);
  assert.equal(workers[0].terminationCalls, 1);
  await pending(result);
  workers[0].confirmExit(0);
  await assert.rejects(result, /synthetic transport failure/);
});

for (const termination of ['throws', 'missing', 'rejects']) {
  test(`unconfirmed retirement retains registry capacity (${termination})`, async () => {
    const { workers, WorkerImpl } = controlled({ termination });
    const registry = createTenantRegistry({ maxTenants: 1, WorkerImpl });
    registry.open('alpha');
    await assert.rejects(registry.close('alpha'), /E_TENANT_TERMINATION/);
    assert.equal(registry.size, 1, 'unverified retirement cannot release capacity');
    assert.throws(() => registry.open('alpha'), /duplicate/);
    assert.equal(workers[0].terminationCalls, 1);
  });
}

test('closeAll retains only unresolved tenants until their retirement receipts', async () => {
  const { workers, WorkerImpl } = controlled();
  const registry = createTenantRegistry({ maxTenants: 2, WorkerImpl });
  registry.open('alpha');
  registry.open('beta');
  const operation = registry.closeAll();
  assert.equal(registry.size, 2);
  workers[0].confirmExit(0);
  await nextTurn();
  assert.equal(registry.size, 1);
  await pending(operation);
  workers[1].confirmExit(0);
  await operation;
  assert.equal(registry.size, 0);
});

test('unexpected real Worker exit rejects pending RPC without extra terminate', async () => {
  const { workers, WorkerImpl } = controlled();
  const session = createTenantSession({ tenantId: 'exit', WorkerImpl });
  const opening = session.start(wasm());
  workers[0].emit('exit', 8);
  await assert.rejects(opening, /worker exited/);
  assert.equal(workers[0].terminationCalls, 0);
  await session.close();
  assert.equal(session.retired, true);
});

test('persistent tenant validates a private Wasm copy before Worker admission', async () => {
  const { workers, WorkerImpl } = controlled();
  const session = createTenantSession({ tenantId: 'snapshot', WorkerImpl });
  const source = wasm(), realValidate = WebAssembly.validate;
  let validated, opening;
  try {
    WebAssembly.validate = input => {
      validated = input;
      const ok = realValidate(input);
      source[0] = 255; // simulate caller mutation immediately after validation
      return ok;
    };
    opening = session.start(source);
  } finally {
    WebAssembly.validate = realValidate;
  }
  assert.notStrictEqual(validated, source);
  assert.equal(source[0], 255);
  assert.equal(workers[0].frame.wasm[0], 0);
  workers[0].emit('message', {
    id: workers[0].frame.id, ok: true, actors: 0,
    value: '0', stdout: '', truncated: false
  });
  assert.equal((await opening).actorHandles.length, 0);
  const closing = session.close();
  workers[0].confirmExit(0);
  await closing;
});

test('persistent start rejects malformed Worker replies only after confirmed retirement', async () => {
  const valid = { ok: true, actors: 1, value: '42', stdout: '', truncated: false };
  const forged = [
    { ...valid, value: '9223372036854775808' },
    { ...valid, value: '00042' },
    { ...valid, value: undefined },
    { ...valid, stdout: 'x'.repeat(64 * 1024 + 1) },
    { ...valid, truncated: 'false' },
    { ...valid, actors: 17 },
    { ...valid, actorFault: true },
    { ...valid, actorFault: 'E_RUNTIME: forged panic' },
    { ...valid, ok: 'true' },
    { ...valid, ok: false, message: '' }
  ];
  for (const reply of forged) {
    const { workers, WorkerImpl } = controlled();
    const session = createTenantSession({ tenantId: 'bad-start', WorkerImpl });
    const opening = session.start(wasm());
    workers[0].emit('message', { id: workers[0].frame.id, ...reply });
    assert.equal(session.closed, true, 'protocol failure must close admissions');
    assert.equal(session.retired, false);
    assert.equal(workers[0].terminationCalls, 1);
    await pending(opening);
    workers[0].confirmExit(0);
    await assert.rejects(opening, /E_TENANT_PROTOCOL: malformed start response/);
    assert.equal(session.retired, true);
  }
});

test('persistent send rejects forged actor faults, output overflow and false success', async () => {
  const good = { ok: true, actors: 1, stdout: '', truncated: false };
  for (const invalid of [
    { ...good, actorFault: true },
    { ...good, value: '42' },
    { ...good, stdout: 'x'.repeat(64 * 1024 + 1) },
    { ...good, actors: -1 },
    { ...good, truncated: null },
    { ...good, ok: false, actorFault: true, message: 'E_RUNTIME: forged local fault' },
    { ...good, ok: false, actorFault: true, message: '' },
    { ...good, ok: false, message: 'x'.repeat(4097) }
  ]) {
    const { workers, WorkerImpl } = controlled();
    const session = createTenantSession({ tenantId: 'bad-send', WorkerImpl });
    const started = await startSession(session, workers[0], 1);
    const result = session.send(started.actorHandles[0], 1n);
    workers[0].emit('message', { id: workers[0].frame.id, ...invalid });
    assert.equal(session.closed, true);
    assert.equal(workers[0].terminationCalls, 1);
    await pending(result);
    workers[0].confirmExit(0);
    await assert.rejects(result, /E_TENANT_PROTOCOL: malformed send response/);
    assert.equal(session.retired, true);
  }
});

test('a correctly typed dead-actor response keeps healthy sibling admissions open', async () => {
  const { workers, WorkerImpl } = controlled();
  const session = createTenantSession({ tenantId: 'local-fault', WorkerImpl });
  const started = await startSession(session, workers[0], 2);
  const dead = session.send(started.actorHandles[0], 5n);
  workers[0].emit('message', {
    id: workers[0].frame.id, ok: false, actorFault: true,
    message: 'E_ACTOR_DEAD: target actor terminated',
    actors: 2, stdout: '', truncated: false
  });
  assert.equal((await dead).actorFault, true);
  assert.equal(session.closed, false);
  const healthy = session.send(started.actorHandles[1], 7n);
  workers[0].emit('message', {
    id: workers[0].frame.id, ok: true,
    actors: 2, stdout: '7\\n', truncated: false
  });
  assert.equal((await healthy).stdout, '7\\n');
  const closing = session.close();
  workers[0].confirmExit(0);
  await closing;
});
