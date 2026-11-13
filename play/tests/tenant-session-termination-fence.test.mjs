import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createTenantSession, createTenantRegistry } from '../node/tenant-session.mjs';

const WASM = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
const tick = () => new Promise(resolve => setImmediate(resolve));

test('persistent tenant close remains pending until worker termination receipt', async () => {
  let release;
  let asked = 0;
  class ControlledWorker extends EventEmitter {
    postMessage() {}
    terminate() {
      asked++;
      return new Promise(resolve => { release = resolve; });
    }
  }
  const tenant = createTenantSession({tenantId:'close-fence',WorkerImpl:ControlledWorker});
  let settled = false;
  const closing = tenant.close().then(() => { settled = true; });
  await tick();
  assert.equal(tenant.closed, true);
  assert.equal(asked, 1);
  assert.equal(settled, false);
  release(0);
  await closing;
  assert.equal(settled, true);
  await tenant.close();
  assert.equal(asked, 1, 'termination must only be invoked once');
});

test('persistent tenant timeout waits for termination before rejecting pending RPC', async () => {
  let release, terminated = 0;
  class StuckWorker extends EventEmitter {
    postMessage() {}
    terminate() { terminated++; return new Promise(resolve => { release = resolve; }); }
  }
  const tenant = createTenantSession({
    tenantId:'stuck-fence', WorkerImpl: StuckWorker, timeoutMs:10
  });
  const start = tenant.start(WASM);
  let outcome;
  start.then(() => { outcome = 'success'; }, error => { outcome = error.message; });
  await new Promise(resolve => setTimeout(resolve, 35));
  assert.equal(terminated, 1);
  assert.equal(outcome, undefined, 'timeout is not completion until worker exits');
  release(0);
  await assert.rejects(start, /execution deadline exceeded/);
  assert.equal(tenant.closed, true);
});

test('persistent tenant propagates a failed termination receipt', async () => {
  class RejectingWorker extends EventEmitter {
    postMessage() {}
    terminate() { return Promise.reject(new Error('no termination proof')); }
  }
  const tenant = createTenantSession({tenantId:'reject-fence',WorkerImpl:RejectingWorker});
  await assert.rejects(tenant.close(), error =>
    error.message.includes('E_TENANT_TERMINATION') && error.cause?.message === 'no termination proof');
});

test('registry keeps tenant IDs reserved until old worker confirms termination', async () => {
  let release;
  class DelayedWorker extends EventEmitter {
    postMessage() {}
    terminate() { return new Promise(resolve => { release = resolve; }); }
  }
  const registry = createTenantRegistry({maxTenants:1,WorkerImpl:DelayedWorker});
  const a = registry.open('same-tenant');
  const closing = registry.close('same-tenant');
  await tick();
  assert.equal(registry.size, 1);
  assert.throws(() => registry.open('same-tenant'), /duplicate tenant ID/);
  release(0);
  assert.equal(await closing, true);
  assert.equal(registry.size, 0);
  const b = registry.open('same-tenant');
  assert.notEqual(a, b);
  const secondClosing = registry.close('same-tenant');
  release(0);
  await secondClosing;
});

test('closeAll blocks concurrent tenant opens until every worker is terminated', async () => {
  let release;
  class ControlledWorker extends EventEmitter {
    postMessage() {}
    terminate() { return new Promise(resolve => { release = resolve; }); }
  }
  const registry = createTenantRegistry({maxTenants:2,WorkerImpl:ControlledWorker});
  registry.open('old');
  const closing = registry.closeAll();
  await tick();
  assert.equal(registry.size, 1, 'existing tenant ID remains reserved while closing');
  assert.throws(() => registry.open('new'), /registry closing/);
  await assert.rejects(registry.closeAll(), /registry already closing/);
  release(0);
  await closing;
  assert.equal(registry.size, 0);
  registry.open('new');
  const secondClosing = registry.closeAll();
  release(0);
  await secondClosing;
  assert.equal(registry.size, 0);
});

test('failed closeAll cannot silently release a potentially live tenant ID', async () => {
  class UnconfirmedWorker extends EventEmitter {
    postMessage() {}
    terminate() { return Promise.reject(new Error('cannot confirm exit')); }
  }
  const registry = createTenantRegistry({maxTenants:1,WorkerImpl:UnconfirmedWorker});
  registry.open('quarantined');
  await assert.rejects(registry.closeAll(), /E_TENANT_TERMINATION/);
  assert.equal(registry.size, 1, 'retain tenant ID on failed termination');
  assert.throws(() => registry.open('quarantined'), /duplicate tenant ID/);
  assert.throws(() => registry.open('other'), /registry full/);
});
