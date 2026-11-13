import test from 'node:test';
import assert from 'node:assert/strict';
import { admitWasm32Memory } from '../src/wasm-memory-admission.js';
import { runTenantWasm } from '../node/tenant-vm.mjs';
import { createTenantSession } from '../node/tenant-session.mjs';

const header = [0, 97, 115, 109, 1, 0, 0, 0];
function leb(v) {
  const result = [];
  do {
    let b = v & 127;
    v = Math.floor(v / 128);
    if (v) b |= 128;
    result.push(b);
  } while (v);
  return result;
}
function section(id, contents) { return [id, ...leb(contents.length), ...contents]; }
function name(s) {
  const bytes = [...new TextEncoder().encode(s)];
  return [...leb(bytes.length), ...bytes];
}
function memorySection(flags, min, max) {
  const body = [1, ...leb(flags), ...leb(min)];
  if (max !== undefined) body.push(...leb(max));
  return section(5, body);
}
function wasmMemoryOnly(flags, min, max) {
  return new Uint8Array([...header, ...memorySection(flags, min, max)]);
}
function wasmMainWithMemory(pages) {
  const type = section(1, [1, 0x60, 0, 1, 0x7e]); // () -> i64
  const func = section(3, [1, 0]);
  const memory = memorySection(1, pages, pages);
  const exports = section(7, [2, ...name('main'), 0, 0, ...name('memory'), 2, 0]);
  const code = section(10, [1, 4, 0, 0x42, 42, 0x0b]); // return i64 42
  return new Uint8Array([...header, ...type, ...func, ...memory, ...exports, ...code]);
}

test('bounded, unshared Wasm32 memories are admitted within 16 pages', () => {
  const bytecode = wasmMemoryOnly(1, 1, 16);
  assert.equal(WebAssembly.validate(bytecode), true);
  assert.equal(admitWasm32Memory(bytecode).memoryCount, 1);
  assert.equal(admitWasm32Memory(new Uint8Array(header)).memoryCount, 0);
});

test('Wasm memory admission rejects an over-quota valid guest before execution', async () => {
  const oversized = wasmMainWithMemory(17);
  assert.equal(WebAssembly.validate(oversized), true);
  assert.throws(() => admitWasm32Memory(oversized), /E_ACTOR_MEMORY: declared memory exceeds 16 pages/);
  const result = await runTenantWasm({tenantId:'quota-check',wasm:oversized});
  assert.equal(result.ok, false);
  assert.match(result.message, /^E_ACTOR_MEMORY:/);
  const admitted = await runTenantWasm({tenantId:'under-quota', wasm:wasmMainWithMemory(16)});
  assert.equal(admitted.ok, true, admitted.message);
  assert.equal(admitted.value, '42');
});

test('Wasm32 admission rejects unbounded and shared memory and memory64', () => {
  assert.equal(WebAssembly.validate(wasmMemoryOnly(0, 1)), true);
  assert.throws(() => admitWasm32Memory(wasmMemoryOnly(0, 1)), /bounded private Wasm32/);
  assert.throws(() => admitWasm32Memory(wasmMemoryOnly(3, 1, 1)), /bounded private Wasm32/);
  assert.throws(() => admitWasm32Memory(wasmMemoryOnly(5, 1, 1)), /bounded private Wasm32/);
});

test('Wasm memory admission rejects malformed section bounds and multi-memory', () => {
  assert.throws(() => admitWasm32Memory(new Uint8Array([...header, 5, 128])), /truncated LEB32/);
  assert.throws(() => admitWasm32Memory(new Uint8Array([...header, 5, 20, 1, 1])), /malformed Wasm section bounds/);
  assert.throws(() => admitWasm32Memory(new Uint8Array([...header, ...section(5, [2])])), /multi-memory guest/);
});

test('memory-like bytes in custom sections cannot be confused with memory declarations', () => {
  const custom = section(0, [...name('test'), 5, 1, 17, 1]);
  const bytes = new Uint8Array([...header, ...custom, ...memorySection(1, 1, 16)]);
  assert.equal(WebAssembly.validate(bytes), true);
  assert.equal(admitWasm32Memory(bytes).memoryCount, 1);
});


test('persistent Node session fails memory quota before guest instantiation', async () => {
  const oversized = wasmMainWithMemory(17);
  assert.equal(WebAssembly.validate(oversized), true);
  const tenant = createTenantSession({ tenantId: 'persistent-memory-reject' });
  try {
    const result = await tenant.start(oversized);
    assert.equal(result.ok, false);
    assert.match(result.message, /^E_ACTOR_MEMORY:/);
    assert.equal(tenant.closed, true);
  } finally {
    await tenant.close();
  }
});
