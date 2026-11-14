import test from 'node:test';
import assert from 'node:assert/strict';
import { detectActorAbi, requireGuestAbiV2 } from '../src/actor-abi-version.js';
import { runTenantWasm } from '../node/tenant-vm.mjs';
import { createTenantSession } from '../node/tenant-session.mjs';
const run_tenant = wasm => runTenantWasm({tenantId:'abi-version',wasm});

function leb(value) {
  const out = [];
  do {
    let b = value & 0x7f;
    value >>>= 7;
    if (value) b |= 0x80;
    out.push(b);
  } while (value);
  return out;
}
function section(type, body) { return [type, ...leb(body.length), ...body]; }
function name(text) {
  const bytes = [...new TextEncoder().encode(text)];
  return [...leb(bytes.length), ...bytes];
}
function wasmWithMarkers(...markers) {
  const base = [
    0,97,115,109,1,0,0,0,
    ...section(1, [1,0x60,0,1,0x7e]),  // () -> i64
    ...section(3, [1,0]),               // main has type 0
    ...section(7, [1,...name('main'),0,0]),
    ...section(10,[1,4,0,0x42,42,0x0b]) // return 42
  ];
  for (const m of markers) base.push(...section(0,[...name('atto.actor.abi'),...m]));
  const wasm = new Uint8Array(base);
  assert.equal(WebAssembly.validate(wasm), true, 'real core Wasm fixture required');
  return wasm;
}
const moduleOf = (...markers) => new WebAssembly.Module(wasmWithMarkers(...markers));

test('legacy unmarked and explicitly tagged v2 modules are admitted', async () => {
  assert.equal(detectActorAbi(moduleOf()), 2);
  assert.equal(requireGuestAbiV2(moduleOf([2,0])), 2);
  const result = await run_tenant(wasmWithMarkers());
  assert.equal(result.ok, true, result.message);
  assert.equal(result.value, '42');
});

test('draft actor_resume v3 is identified but never silently run as v2', async () => {
  const module = moduleOf([3,0]);
  assert.equal(detectActorAbi(module), 3);
  assert.throws(() => requireGuestAbiV2(module), /^Error: E_GUEST_ABI_UNSUPPORTED:/);
  const result = await run_tenant(wasmWithMarkers([3,0]));
  assert.equal(result.ok, false);
  assert.match(result.message, /^E_GUEST_ABI_UNSUPPORTED: actor_resume v3/);
});

test('duplicate, malformed and unknown markers are rejected', async () => {
  for (const markers of [[[3,0],[3,0]],[[3]],[[3,0,0]],[[3,1]],[[4,0]],[[255,0]]]) {
    assert.throws(() => requireGuestAbiV2(moduleOf(...markers)), /E_GUEST_ABI:/);
    const result = await run_tenant(wasmWithMarkers(...markers));
    assert.equal(result.ok, false);
    assert.match(result.message, /^E_GUEST_ABI:/);
  }
});

test('persistent Node tenant rejects v3 instead of allocating an actor instance', async () => {
  const tenant = createTenantSession({tenantId:'v3-not-enabled'});
  try {
    const result = await tenant.start(wasmWithMarkers([3,0]));
    assert.equal(result.ok, false);
    assert.match(result.message, /^E_GUEST_ABI_UNSUPPORTED:/);
    assert.equal(tenant.closed, true);
  } finally {
    await tenant.close();
  }
});
