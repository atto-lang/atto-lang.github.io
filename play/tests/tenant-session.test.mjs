import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Worker } from 'node:worker_threads';
import { createCompiler } from '../src/compiler.js';
import { createTenantSession, createTenantRegistry } from '../node/tenant-session.mjs';

const compiler = await createCompiler(await readFile(new URL('../public/atto_compiler.wasm', import.meta.url)));
const COUNTERS = `define actor Counter as
  let int total = 0;
  receive(ActorMail<int> mail): void {
    self.total = self.total + mail.value;
    stdio.println(self.total);
    return;
  }
end
pub fnc main(): int {
  val a = spawn Counter();
  val b = spawn Counter();
  a.send(5); a.send(7); b.send(100);
  return 42;
}`;
const compile = source => {
  const r = compiler.compile(source);
  assert.equal(r.ok, true, JSON.stringify(r.diagnostics));
  return r.wasm;
};

test('Node tenant session preserves separate actor heaps across mailbox turns in ONE worker', async () => {
  let created = 0;
  class CountedWorker extends Worker {
    constructor(...args) { super(...args); created++; }
  }
  const tenant = createTenantSession({ tenantId: 'tenant-session-alpha', WorkerImpl: CountedWorker });
  try {
    const start = await tenant.start(compile(COUNTERS));
    assert.equal(start.ok, true, start.message);
    assert.equal(created, 1);
    assert.equal(start.value, '42');
    assert.equal(start.actors, 2);
    assert.deepEqual(start.stdout.trim().split('\n'), ['5', '100', '12']);
    const [a, b] = start.actorHandles;
    const one = await tenant.send(a, 3n);
    assert.equal(one.ok, true, one.message);
    assert.equal(one.stdout, '15\n');
    const two = await tenant.send(b, -50n);
    assert.equal(two.ok, true, two.message);
    assert.equal(two.stdout, '50\n');
    const three = await tenant.send(a, 10n);
    assert.equal(three.ok, true, three.message);
    assert.equal(three.stdout, '25\n');
    assert.equal(created, 1, 'follow-up mail must not create extra Workers');
    await assert.rejects(tenant.start(compile(COUNTERS)), /already started/);
  } finally {
    await tenant.close();
  }
  assert.equal(tenant.closed, true);
});

test('registry prevents duplicates and enforces cross-tenant and stale ActorRefs', async () => {
  const registry = createTenantRegistry({ maxTenants: 2 });
  const wasm = compile(COUNTERS);
  try {
    const a = registry.open('alpha');
    const b = registry.open('beta');
    assert.equal(registry.size, 2);
    assert.throws(() => registry.open('alpha'), /duplicate/);
    assert.throws(() => registry.open('gamma'), /registry full/);
    const ar = await a.start(wasm);
    const br = await b.start(wasm);
    assert.equal(ar.ok, true, ar.message);
    assert.equal(br.ok, true, br.message);
    await assert.rejects(b.send(ar.actorHandles[0], 1n), /cross-tenant/);
    await assert.rejects(a.send(Object.freeze({ tenantId: 'alpha', actor: 0 }), 1n), /cross-tenant/);
    await assert.rejects(a.send(ar.actorHandles[0], 2), /BigInt/);
    const r = await b.send(br.actorHandles[0], 1n);
    assert.equal(r.stdout, '13\n');
    await registry.close('alpha');
    assert.equal(a.closed, true);
    await assert.rejects(a.send(ar.actorHandles[0], 1n), /not running/);
    const newer = registry.open('alpha');
    const newerStart = await newer.start(wasm);
    assert.equal(newerStart.ok, true);
    await assert.rejects(newer.send(ar.actorHandles[0], 1n), /cross-tenant/);
    assert.equal((await newer.send(newerStart.actorHandles[0], 1n)).stdout, '13\n');
  } finally {
    await registry.closeAll();
  }
  assert.equal(registry.size, 0);
});

test('non-cooperative actor is terminated on deadline without affecting another tenant', async () => {
  const spin = compile(`define actor Spin as
    receive(ActorMail<int> mail): void { loop { } }
  end
  pub fnc main(): int { val a = spawn Spin(); return 0; }`);
  const live = createTenantSession({ tenantId: 'loop', timeoutMs: 800 });
  try {
    const started = await live.start(spin);
    assert.equal(started.ok, true, started.message);
    await assert.rejects(live.send(started.actorHandles[0], 1n), /deadline/);
    assert.equal(live.closed, true);
  } finally {
    await live.close();
  }
  const healthy = createTenantSession({ tenantId: 'healthy' });
  try {
    const started = await healthy.start(compile(COUNTERS));
    assert.equal(started.ok, true, started.message);
    assert.equal((await healthy.send(started.actorHandles[1], 3n)).stdout, '103\n');
  } finally {
    await healthy.close();
  }
});

test('failed guest admission closes session and rejects subsequent commands', async () => {
  const tenant = createTenantSession({ tenantId: 'bad-guest' });
  try {
    const result = await tenant.start(new Uint8Array([0,97,115,109,1,0,0,0]));
    assert.equal(result.ok, false);
    assert.match(result.message, /guest|main/i);
    assert.equal(tenant.closed, true);
    await assert.rejects(tenant.start(compile(COUNTERS)), /already started/);
  } finally {
    await tenant.close();
  }
});

test('tenant session validates inputs before constructing workers', () => {
  assert.throws(() => createTenantSession({ tenantId: '../unsafe' }), /tenant ID/);
  assert.throws(() => createTenantSession({ tenantId: 'safe', timeoutMs: -1 }), /deadline/);
  assert.throws(() => createTenantRegistry({ maxTenants: 0 }), /capacity/);
});
