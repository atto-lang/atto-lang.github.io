import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Worker } from 'node:worker_threads';
import { createCompiler } from '../src/compiler.js';
import { runTenantWasm } from '../node/tenant-vm.mjs';

const compiler = await createCompiler(await readFile(new URL('../public/atto_compiler.wasm', import.meta.url)));
const SOURCE = `define actor Counter as
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

test('Node TenantVM creates only one V8 worker for multiple guest actors', async () => {
  const compiled = compiler.compile(SOURCE);
  assert.equal(compiled.ok, true);
  let created = 0;
  class CountedWorker extends Worker {
    constructor(...args) { super(...args); created++; }
  }
  const result = await runTenantWasm({ tenantId: 'alpha', wasm: compiled.wasm, WorkerImpl: CountedWorker });
  assert.equal(created, 1);
  assert.equal(result.ok, true, result.message);
  assert.equal(result.value, '42');
  assert.equal(result.actors, 2);
  assert.deepEqual(result.stdout.trim().split('\n'), ['5', '100', '12']);
});

test('separate Node tenants have independent worker threads and actor state', async () => {
  const compiled = compiler.compile(SOURCE);
  assert.equal(compiled.ok, true);
  let workers = 0;
  class CountedWorker extends Worker {
    constructor(...args) { super(...args); workers++; }
  }
  const results = await Promise.all(['tenant-A', 'tenant-B'].map(tenantId =>
    runTenantWasm({ tenantId, wasm: compiled.wasm, WorkerImpl: CountedWorker })));
  assert.equal(workers, 2);
  for (const result of results) {
    assert.equal(result.ok, true, result.message);
    assert.equal(result.stdout, '5\n100\n12\n');
    assert.equal(result.actors, 2);
  }
});

test('Node tenant admission rejects malformed ids and untrusted Wasm', () => {
  const good = new Uint8Array([0,97,115,109,1,0,0,0]);
  assert.throws(() => runTenantWasm({ tenantId: '../other', wasm: good }), /tenant ID/);
  assert.throws(() => runTenantWasm({ tenantId: 'ok', wasm: new Uint8Array([1,2,3]) }), /validated guest Wasm/);
  assert.throws(() => runTenantWasm({ tenantId: 'ok', wasm: good, timeoutMs: 0 }), /deadline/);
});

test('a looping tenant is terminated on deadline without affecting the next tenant', async () => {
  const looping = compiler.compile(`define actor Spin as
    receive(ActorMail<int> mail): void { loop { } }
  end
  pub fnc main(): int { val a = spawn Spin(); a.send(1); return 0; }`);
  assert.equal(looping.ok, true, JSON.stringify(looping.diagnostics));
  await assert.rejects(
    runTenantWasm({ tenantId: 'loop', wasm: looping.wasm, timeoutMs: 250 }),
    /deadline/
  );
  const healthy = compiler.compile('pub fnc main(): int { return 42; }');
  const r = await runTenantWasm({ tenantId: 'healthy', wasm: healthy.wasm });
  assert.equal(r.ok, true);
  assert.equal(r.value, '42');
});
