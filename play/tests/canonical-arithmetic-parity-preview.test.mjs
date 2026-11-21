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

test('pinned Rust/Wasm compiler cannot silently execute obsolete operator and division semantics', async () => {
  const [bytes, receiptText] = await Promise.all([
    readFile(new URL('public/atto_compiler.wasm', root)),
    read('public/atto_compiler.receipt.json')
  ]);
  const receipt = JSON.parse(receiptText);
  assert.equal(bytes.length, receipt.compiler_bytes);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), receipt.compiler_sha256);
  const compiler = await createCompiler(bytes);
  const forbidden = [
    ['int division must not truncate into int return', 'pub fnc main(): int { return 5 / 2; }'],
    ['single infix caret cannot be bitwise XOR', 'pub fnc main(): int { return 12 ^ 10; }'],
    ['boolean ^^ cannot be overloaded XOR', 'pub fnc main(): int { val b = true ^^ false; return 42; }'],
    ['shift count 64 must not wrap to zero', 'pub fnc main(): int { return 1 <<< 64; }']
  ];
  for (const [name, source] of forbidden) {
    const result = compiler.compile(source);
    assert.equal(result.ok, false, name + ': outdated compiler MUST NOT be promoted');
    assert.equal(Object.hasOwn(result, 'wasm'), false, name + ': no executable artifact on rejection');
    assert.match(result.diagnostics?.[0]?.message ?? '', /^E_[A-Z0-9_]+:/,
      name + ': compiler-owned diagnostic needed');
  }
  const healthy = compiler.compile('pub fnc main(): int { return 42; }');
  assert.equal(healthy.ok, true, 'ordinary bad source must not poison the compiler');
  assert.ok(WebAssembly.validate(healthy.wasm));
  assert.equal(new WebAssembly.Instance(new WebAssembly.Module(healthy.wasm)).exports.main(), 42n);
});
