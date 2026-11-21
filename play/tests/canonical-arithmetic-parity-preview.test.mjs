// Canonical language contracts are NOT equivalent to the pinned public Wasm ABI.
// This is a source-to-guest release blocker, not a host-JS arithmetic oracle.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createCompiler } from '../src/compiler.js';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');

test('canonical arithmetic preview is discoverable but cannot masquerade as executed guest parity', async () => {
  const [source, html, app, profileText, release, canonicalTrap, legacyTrap] = await Promise.all([
    read('examples/preview/checked-arithmetic-division.atto'),
    read('index.html'), read('src/app.js'), read('example-backend-profile.json'),
    read('../.github/scripts/package-playground.mjs'),
    read('examples/preview/trap-result.atto'),
    read('examples/preview/trap.atto')
  ]);
  const profile = JSON.parse(profileText);
  const key = 'checked-arithmetic-division';
  assert.equal(profile.preview.filter(p => p.name === key).length, 1);
  assert.deepEqual(profile.preview.find(p => p.name === key), {name: key, expect: 'preview-only'});
  const registered = JSON.parse(app.match(/const PREVIEW_EXAMPLES = new Set\((\[[^\n]+\])\)/)[1]);
  const executable = JSON.parse(app.match(/const EXECUTABLE_PREVIEWS = new Set\((\[[^\n]+\])\)/)[1]);
  assert.equal(registered.filter(p => p === 'preview/' + key).length, 1);
  assert.ok(!executable.includes('preview/' + key), 'do not promote compiler-unverified preview');
  assert.equal(html.split('value="preview/' + key + '"').length - 1, 1);
  assert.equal(release.split("'examples/preview/" + key + ".atto'").length - 1, 1);
  assert.match(source, /^\/\/ SYNTAX PREVIEW — NOT browser-lowered/);
  assert.match(source, /fnc half\(int numerator, int denominator\): float/);
  assert.match(source, /return numerator \/ denominator;/);
  assert.match(source, /return \(numerator \+ 1\) \/ denominator;/);
  assert.match(source, /val quotient: float = half\(5, 2\)/);
  assert.match(source, /12 \^\^ 10/);
  assert.match(source, /1 <<< 63/);
  assert.match(source, /Xor\(true, false\)/);
  assert.match(source, /\^ 42;/);
  for (const negative of ['float cannot implicitly narrow', 'checked fault',
    '0..63', 'Boolean XOR', 'NEVER infix XOR', 'not shift']) {
    assert.ok(source.includes(negative), negative);
  }
  assert.match(canonicalTrap, /trap checked_id\(5\)/);
  assert.match(legacyTrap, /LEGACY PINNED COMPILER SEMANTICS/);
  assert.match(app, /Legacy pinned Rust\/Wasm trap \(Option-based\)/);
});

test('pinned Rust/Wasm compiler must reject obsolete semantics and execute the canonical subset', async t => {
  const [bytes, receiptText] = await Promise.all([
    readFile(new URL('public/atto_compiler.wasm', root)),
    read('public/atto_compiler.receipt.json')
  ]);
  const receipt = JSON.parse(receiptText);
  assert.equal(bytes.length, receipt.compiler_bytes, 'binary size is receipt-pinned');
  assert.equal(createHash('sha256').update(bytes).digest('hex'), receipt.compiler_sha256,
    'binary digest is receipt-pinned');
  const compiler = await createCompiler(bytes);

  // Run every independent guest admission check, even when an older binary
  // violates one contract. A single early caret failure must not hide a
  // second, potentially dangerous masked-shift or integer-division bug.
  const forbidden = [
    ['float division must not narrow into int return',
      'pub fnc main(): int { return 5 / 2; }'],
    ['single infix caret is not integer XOR',
      'pub fnc main(): int { return 12 ^ 10; }'],
    ['boolean double caret is not XOR',
      'pub fnc main(): int { val b = true ^^ false; return 42; }'],
    ['shift count 64 must not silently become count 0',
      'pub fnc main(): int { return 1 <<< 64; }'],
    ['negative shift count must not silently become count 63',
      'pub fnc main(): int { return 1 >>> -1; }']
  ];
  for (const [name, source] of forbidden) {
    await t.test('no Wasm artifact: ' + name, () => {
      const result = compiler.compile(source);
      assert.equal(result.ok, false,
        name + ': compiler accepted forbidden source; do not publish obsolete guest behavior');
      assert.equal(Object.hasOwn(result, 'wasm'), false,
        name + ': compiler must not produce an artifact on semantic rejection');
      assert.match(result.diagnostics?.[0]?.message ?? '', /^E_[A-Z0-9_]+:/,
        name + ': require compiler-owned diagnostic');
    });
  }

  const canonical = [
    ['prefix ^ returns from the callable',
      'pub fnc main(): int { ^ 42; }', 42n],
    ['integer ^^ is bitwise XOR',
      'pub fnc main(): int { return 12 ^^ 10; }', 6n],
    ['signed i64 shift at distance 63',
      'pub fnc main(): int { return 1 <<< 63; }', -9223372036854775808n],
    ['int/int division produces a real floating result',
      'fnc half(int numerator, int denominator): float { return numerator / denominator; }\n' +
      'pub fnc main(): int { if half(5, 2) eq 2.5 then return 42; fi return 1; }',
      42n]
  ];
  for (const [name, source, expected] of canonical) {
    await t.test('compiled Wasm guest: ' + name, () => {
      const result = compiler.compile(source);
      assert.equal(result.ok, true,
        name + ': feature unsupported in pinned compiler ' + JSON.stringify(result.diagnostics));
      assert.equal(WebAssembly.validate(result.wasm), true);
      const module = new WebAssembly.Module(result.wasm);
      assert.deepEqual(WebAssembly.Module.imports(module), [],
        name + ': pure scalar guest cannot acquire host capabilities');
      const instance = new WebAssembly.Instance(module, { atto: {} });
      assert.equal(instance.exports.main(), expected, name + ': actual guest return');
      assert.equal(instance.exports.panic_code?.value ?? 0, 0,
        name + ': guest must not panic on valid source');
    });
  }

  await t.test('computed invalid shift never executes modulo-64', () => {
    const result = compiler.compile(
      'pub fnc main(): int { let distance: int = 64; return 1 <<< distance; }');
    if (!result.ok) {
      assert.equal(Object.hasOwn(result, 'wasm'), false);
      assert.match(result.diagnostics?.[0]?.message ?? '', /^E_[A-Z0-9_]+:/);
      return; // Safe fail-closed while support is under review.
    }
    assert.equal(WebAssembly.validate(result.wasm), true);
    const module = new WebAssembly.Module(result.wasm);
    assert.deepEqual(WebAssembly.Module.imports(module), [],
      'no guest I/O required for checked shifts');
    const instance = new WebAssembly.Instance(module, { atto: {} });
    assert.throws(() => instance.exports.main(), WebAssembly.RuntimeError,
      'computed 64 must trap instead of silently becoming count zero');
    assert.equal(instance.exports.panic_code?.value, 7,
      'shift-distance fault is a language panic, not a masked result');
  });

  await t.test('compiler survives source diagnostics and still emits a healthy guest', () => {
    const healthy = compiler.compile('pub fnc main(): int { return 42; }');
    assert.equal(healthy.ok, true, 'semantic errors cannot poison compiler instance');
    assert.ok(WebAssembly.validate(healthy.wasm));
    const module = new WebAssembly.Module(healthy.wasm);
    assert.deepEqual(WebAssembly.Module.imports(module), []);
    assert.equal(new WebAssembly.Instance(module).exports.main(), 42n);
  });
});
