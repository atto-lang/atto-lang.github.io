// Worker-local state lease ABI v1 host (src/state-runtime.js), ported from
// atto-source.rs tests/state-runtime.test.mjs, plus the guest import grant rule.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createStateRuntime } from '../src/state-runtime.js';
import { createCompiler } from '../src/compiler.js';
import { guestImports, usesStateLeases } from '../src/guest.js';

test('host-issued i64 ticket, closed without replay, retirement fenced', () => {
  const events = [], runtime = createStateRuntime({requireBoundMemory:false, onEvent: e => events.push(e.kind) });
  const { state_register, state_enter, state_leave } = runtime.imports;
  state_register(0);
  state_register(8);
  const a = state_enter(0, 0);
  const b = state_enter(0, 0);
  assert.equal(typeof a, 'bigint');
  assert.notEqual(a, b);
  assert.throws(() => state_enter(0, 1), /contention/);
  assert.throws(() => state_enter(8, 9), /invalid lease mode/);
  assert.throws(() => state_enter(16, 0), /unknown state container/);
  state_leave(a);
  state_leave(b);
  assert.throws(() => state_leave(a), /replayed admission ticket/);
  const c = state_enter(8, 1);
  state_leave(c);
  runtime.complete();
  assert.equal(runtime.snapshot().active, 0);
  assert.deepEqual(events.slice(0, 2), ['register', 'register']);
  assert.throws(() => state_register(24), /after retirement/);
});

test('successful completion refuses an unreleased lease; abort drops it', () => {
  const runtime = createStateRuntime({requireBoundMemory:false});
  runtime.imports.state_register(0);
  runtime.imports.state_enter(0, 1);
  assert.throws(() => runtime.complete(), /unreleased state tickets/);
  runtime.abort();
  assert.equal(runtime.snapshot().active, 0);
});

test('state hooks are granted only when the host supplies a runtime', async () => {
  const compiler = await createCompiler(await readFile(new URL('../public/atto_compiler.wasm', import.meta.url)));
  const source = await readFile(new URL('../examples/preview/state-containers.atto', import.meta.url), 'utf8');
  const result = compiler.compile(source);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const module = await WebAssembly.compile(result.wasm);
  assert.equal(usesStateLeases(module), true);
  assert.throws(() => guestImports(module, { text: '', truncated: false }),
    /Guest import not granted: atto\.state_register/);
  const out = { text: '', truncated: false };
  const state = createStateRuntime();
  const { imports, bind } = guestImports(module, out, null, null, { state });
  const instance = await WebAssembly.instantiate(module, imports);
  bind(instance);
  assert.equal(instance.exports.main(), 0n);
  state.complete();
  assert.equal(out.text, '2\n0\n');
});
