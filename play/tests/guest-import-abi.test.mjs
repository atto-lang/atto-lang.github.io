import test from 'node:test';
import {ASSETS} from '../../.github/scripts/package-playground.mjs';
import assert from 'node:assert/strict';
import { validateGuestImportABI } from '../src/guest-import-abi.js';
import { runTenantWasm } from '../node/tenant-vm.mjs';

const MAGIC = [0, 97, 115, 109, 1, 0, 0, 0];
const leb = n => { const out = []; do { let b = n & 127; n = Math.floor(n / 128); if (n) b |= 128; out.push(b); } while (n); return out; };
const section = (id, body) => [id, ...leb(body.length), ...body];
const name = s => { const b = [...new TextEncoder().encode(s)]; return [...leb(b.length), ...b]; };
function guest({ symbol = 'print_i64', namespace = 'atto', params = [0x7e], results = [], repeated = false, kind = 0 } = {}) {
  const types = section(1, [2, 0x60, ...leb(params.length), ...params, ...leb(results.length), ...results,
    0x60, 0, 1, 0x7e]);
  const entry = [...name(namespace), ...name(symbol), kind, ...(kind === 0 ? [0] : [1, 1, 16])];
  const imports = section(2, [repeated ? 2 : 1, ...entry, ...(repeated ? entry : [])]);
  const functions = section(3, [1, 1]);
  const exports = section(7, [1, ...name('main'), 0, repeated ? 2 : 1]);
  const code = section(10, [1, 4, 0, 0x42, 42, 0x0b]);
  return Uint8Array.from([...MAGIC, ...types, ...imports, ...functions, ...exports, ...code]);
}
const admit = (bytes, options) => validateGuestImportABI(bytes, new WebAssembly.Module(bytes), options);

test('exact approved print and actor signatures admit valid core Wasm', () => {
  for (const [symbol, params, results] of [
    ['print_i64', [0x7e], []], ['print_bool', [0x7f], []],
    ['print_str', [0x7f, 0x7f], []], ['print_newline', [], []],
    ['actor_spawn', [0x7f], [0x7f]], ['actor_send', [0x7f, 0x7e], []]
  ]) {
    const bytes = guest({ symbol, params, results });
    assert.equal(WebAssembly.validate(bytes), true, symbol);
    assert.equal(admit(bytes).length, 1, symbol);
  }
  const floating = guest({ symbol: 'print_f64', params: [0x7c] });
  assert.throws(() => admit(floating), /not granted/);
  assert.equal(admit(floating, {allowFloat:true}).length, 1);
});

test('forged signatures pass engine validation but are denied by host admission', async () => {
  for (const wrong of [
    {params:[]}, {params:[0x7f]}, {params:[0x7c]}, {params:[0x7e, 0x7e]}, {results:[0x7e]}
  ]) {
    const bytes = guest(wrong);
    assert.equal(WebAssembly.validate(bytes), true);
    assert.throws(() => admit(bytes), /E_GUEST_ABI: guest import signature mismatch/);
  }
  const result = await runTenantWasm({ tenantId: 'forged-import-v2', wasm: guest({params:[0x7f]}) });
  assert.equal(result.ok, false);
  assert.match(result.message, /^E_GUEST_ABI: guest import signature mismatch/);
});

test('foreign imports, duplicate imports and unnegotiated pipeline authority denied', () => {
  for (const bytes of [
    guest({namespace:'env'}),
    guest({symbol:'__proto__'}),
    guest({repeated:true}),
    guest({symbol:'actor_emit',params:[0x7e]})
  ]) {
    assert.equal(WebAssembly.validate(bytes), true);
    assert.throws(() => admit(bytes), /E_GUEST_ABI:/);
  }
  const pipe = guest({symbol:'actor_emit',params:[0x7e]});
  assert.equal(admit(pipe,{allowPipeline:true}).length, 1, 'v3-only signature is gated by caller policy');
});

test('type/parser failures and import reflection mismatch deny before execution', () => {
  const bytes = guest();
  assert.throws(() => validateGuestImportABI(bytes, new WebAssembly.Module(Uint8Array.from(MAGIC))), /reflection/);
  assert.throws(() => validateGuestImportABI(bytes.subarray(0, 3), new WebAssembly.Module(bytes)), /invalid Wasm bytes/);
  const malformed = Uint8Array.from([...bytes, 0, 0x80, 0]);
  assert.throws(() => validateGuestImportABI(malformed, new WebAssembly.Module(bytes)), /noncanonical LEB32/);
});

test('public release packages the strict Wasm verifier with its importing Worker', () => {
  for (const asset of ['src/runner-worker.js', 'src/guest-import-abi.js']) {
    assert.equal(ASSETS.filter(x => x === asset).length, 1,
      'missing or duplicate runtime import asset: ' + asset);
  }
});

test('worker-local state imports require explicit state policy and exact signatures', () => {
  for (const [symbol, params, results] of [
    ['state_register', [0x7f], []],
    ['state_enter', [0x7f,0x7f], [0x7e]],
    ['state_leave', [0x7e], []]
  ]) {
    const bytes = guest({symbol, params, results});
    assert.equal(WebAssembly.validate(bytes), true, symbol);
    assert.throws(() => admit(bytes), /guest import not granted/, symbol);
    assert.equal(admit(bytes, {allowState:true}).length, 1, symbol);
  }
  for (const params of [[], [0x7e], [0x7f,0x7e]]) {
    const bytes=guest({symbol:'state_enter', params, results:[0x7e]});
    assert.equal(WebAssembly.validate(bytes),true);
    assert.throws(() => admit(bytes, {allowState:true}), /signature mismatch/);
  }
});
