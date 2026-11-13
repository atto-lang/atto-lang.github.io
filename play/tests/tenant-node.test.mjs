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

test('disposable Node Worker admits exactly one guest across overlapping RPC messages', async () => {
  const compiled = compiler.compile(SOURCE);
  assert.equal(compiled.ok, true, JSON.stringify(compiled.diagnostics));
  const worker = new Worker(new URL('../node/tenant-worker.mjs', import.meta.url));
  try {
    const replies = await new Promise((resolve, reject) => {
      const received = [];
      const timeout = setTimeout(() => reject(new Error('one-shot worker replies timed out')), 5000);
      worker.on('error', reject);
      worker.on('message', message => {
        received.push(message);
        if (received.length === 2) {
          clearTimeout(timeout);
          resolve(received);
        }
      });
      // The first guest will cross asynchronous instantiate/drain boundaries.
      // The second, equally valid guest must never create a second actor host.
      worker.postMessage({ wasm: compiled.wasm });
      worker.postMessage({ wasm: compiled.wasm });
    });
    const accepted = replies.filter(r => r.ok);
    const denied = replies.filter(r => r.message?.startsWith('E_TENANT_REUSE:'));
    assert.equal(accepted.length, 1, 'only the first guest may execute');
    assert.equal(accepted[0].value, '42');
    assert.equal(accepted[0].actors, 2);
    assert.equal(accepted[0].stdout, '5\\n100\\n12\\n');
    assert.equal(denied.length, 1, 'concurrent duplicate must be explicitly denied');
    assert.deepEqual({
      ok: denied[0].ok, actors: denied[0].actors,
      stdout: denied[0].stdout, truncated: denied[0].truncated
    }, { ok: false, actors: 0, stdout: '', truncated: false },
    'a rejected request must not leak the admitted guest output or actor count');

    // Even after completion, a disposable Worker never accepts another guest.
    const thirdReply = new Promise((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error('post-completion rejection timeout')), 5000);
      worker.once('message', value => { clearTimeout(deadline); resolve(value); });
    });
    worker.postMessage({ wasm: compiled.wasm });
    const third = await thirdReply;
    assert.match(third.message, /^E_TENANT_REUSE:/);
    assert.equal(third.actors, 0);
    assert.equal(third.stdout, '');
  } finally {
    await worker.terminate();
  }
});
