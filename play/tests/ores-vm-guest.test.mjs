import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { runTenantWasm } from '../node/tenant-vm.mjs';
import { taskGuestAbi } from '../src/ores-vm.js';
import { createCompiler } from '../src/compiler.js';

// Real atto.task.v1 guests compiled from Atto source by the candidate
// atto-source.rs compiler (see fixtures/task-guests/PROVENANCE.json),
// executed by the production tenant runner and its OresVM control loop.
const dir = new URL('../fixtures/task-guests/', import.meta.url);
const provenance = JSON.parse(await readFile(new URL('PROVENANCE.json', dir), 'utf8'));
const guest = async name => {
  const wasm = new Uint8Array(await readFile(new URL(`${name}.wasm`, dir)));
  const sha = createHash('sha256').update(wasm).digest('hex');
  assert.equal(sha, provenance.guests[name].wasm_sha256, `${name} fixture digest`);
  return wasm;
};

const EXPECT = {
  'tasks-async': { value: '42', stdout: '42\n' },
  'timers-sleep': { value: '42', stdout: '' },
  'borrow-suspension': { value: '43', stdout: '' },
  // Wall-clock timers: worker(10) wakes at 20/40/60 ms, worker(1) at 50/100/150 ms,
  // so no two deadlines tie and the order is deterministic on real time.
  'interleaving': { value: '156', stdout: '120\ntrue\n10\n10\n1\n10\n1\n1\nsum\n33\n10000\ndetached\n' },
  // The actor's Mailman delivers mail while main is suspended on a timer.
  'actors-interleave': { value: '5', stdout: '1\n100\n2\n200\n3\n', actors: 1 },
};

for (const [name, want] of Object.entries(EXPECT)) {
  test(`task guest ${name} runs on the OresVM in a tenant worker`, async () => {
    const wasm = await guest(name);
    assert.equal(taskGuestAbi(await WebAssembly.compile(wasm)), true);
    const result = await runTenantWasm({ tenantId: `task-${name}`, wasm, timeoutMs: 5000 });
    assert.equal(result.ok, true, result.message);
    assert.equal(result.value, want.value);
    assert.equal(result.stdout, want.stdout);
    if (want.actors) assert.equal(result.actors, want.actors);
    // Node worker_threads always have shared memory: the tenant Worker is
    // an OresVM carrier thread, not an event-loop-driven scheduler.
    assert.equal(result.scheduler, 'carrier');
  });
}

test('sleeper waits on a real reactor timer, not a busy loop', async () => {
  const started = performance.now();
  const result = await runTenantWasm({ tenantId: 'task-timer', wasm: await guest('timers-sleep'), timeoutMs: 5000 });
  assert.equal(result.ok, true, result.message);
  assert.ok(performance.now() - started >= 95, 'await sleeper(100ms) resumes after ~100 ms');
});

test('a forged task marker without the full export set is rejected before running', async () => {
  const wasm = await guest('tasks-async');
  const module = await WebAssembly.compile(wasm);
  assert.equal(WebAssembly.Module.customSections(module, 'atto.task.v1').length, 1);
  // Strip the custom section: the exports alone must not opt into the ABI.
  const stripped = stripCustomSection(wasm, 'atto.task.v1');
  await assert.rejects(WebAssembly.compile(stripped).then(m => taskGuestAbi(m)), /E_TASK_ABI/);
});

test('the pinned compiler, once it admits susp, reproduces these guests exactly', async () => {
  const compiler = await createCompiler(await readFile(new URL('../public/atto_compiler.wasm', import.meta.url)));
  for (const [name, meta] of Object.entries(provenance.guests)) {
    const source = await readFile(new URL(`../${meta.source}`, import.meta.url), 'utf8');
    const compiled = compiler.compile(source);
    if (!compiled.ok) continue; // pinned compiler predates atto.task.v1
    const sha = createHash('sha256').update(compiled.wasm).digest('hex');
    assert.equal(sha, meta.wasm_sha256, `${name}: pinned compiler output differs from fixture`);
  }
});

function stripCustomSection(bytes, target) {
  const out = [...bytes.slice(0, 8)];
  let i = 8;
  const leb = () => { let v = 0, s = 0, b; do { b = bytes[i++]; v |= (b & 127) << s; s += 7; } while (b & 128); return v; };
  while (i < bytes.length) {
    const start = i;
    const id = bytes[i++];
    const size = leb();
    const body = i;
    i = body + size;
    if (id === 0) {
      let j = body, n = 0, s = 0, b;
      do { b = bytes[j++]; n |= (b & 127) << s; s += 7; } while (b & 128);
      if (new TextDecoder().decode(bytes.slice(j, j + n)) === target) continue;
    }
    out.push(...bytes.slice(start, i));
  }
  return new Uint8Array(out);
}
