// Source and publication gates for immutable collection syntax previews.
// This DOES NOT certify guest execution; pinned-preview-admission.test.mjs
// independently requires real compiler rejection (no guest artifact).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');
const names = [
  'immutable-vector-const',
  'immutable-vector-updates',
  'immutable-vector-rebinding',
  'immutable-list',
  'immutable-map-set',
  'immutable-collection-pipelines'
];
const expected = {
  'immutable-vector-const': [
    'const Vector<int> empty = [];',
    'const Vector<int> primes = [2, 3, 5, 7];',
    'INVALID: const Vector<int> unknown',
  ],
  'immutable-vector-updates': [
    'val Vector<int> extended = base.appended(30);',
    'val Vector<int> revised = extended.updated(0, 99);',
    'return base[0] + extended[2] + revised[0];',
    'INVALID: base[0] = 42;',
  ],
  'immutable-vector-rebinding': [
    'const Vector<int> seed = [1, 2];',
    'val Vector<int> next = seed.appended(3);',
    'let Vector<int> current = next;',
    'current = current.updated(0, 9);',
    'INVALID: val mut Vector<int>',
  ],
  'immutable-list': [
    'val List<int> original = [2, 3];',
    'val List<int> prefixed = original.prepended(1);',
    'val List<int> empty = [];',
    'INVALID: val ambiguous = [];',
  ],
  'immutable-map-set': [
    'val Map<string, int> scores = {"Ada" => 10, "Lin" => 20};',
    'val Map<string, int> adjusted = scores.updated("Ada", 15);',
    'val Set<int> plus_one = visited.inserted(5);',
    'INVALID: scores["Ada"] = 15;',
  ],
  'immutable-collection-pipelines': [
    'source.map(|x| -> x * 2)',
    'doubled.filter(|x| -> x > 4)',
    'large.reduce(0, |acc, value| -> acc + value)',
    'INVALID: source.map(x -> x + 1);',
  ],
};

test('six immutable-collection examples teach exact proposed const, ownership and functional semantics', async t => {
  for (const name of names) await t.test(name, async () => {
    const source = await read('examples/preview/' + name + '.atto');
    assert.match(source, /^\/\/ SYNTAX PREVIEW — NOT browser-lowered by the pinned public compiler\./);
    assert.match(source, /pub fnc main\(\): int \{/);
    assert.ok(source.includes('// INVALID:'), name + ': requires explicit negative examples');
    assert.ok(new TextEncoder().encode(source).length < 4096, name + ': keep editor share-size budget');
    for (const token of expected[name])
      assert.ok(source.includes(token), name + ': missing semantic case: ' + token);
    assert.doesNotMatch(source, /^\s*val mut Vector</m,
      name + ': invalid qualifier may appear only as a commented negative');
    assert.doesNotMatch(source, /^\s*[^/\n]+\[\d+\] = /m,
      name + ': immutable element write must not appear as valid code');
  });
});

test('immutable examples appear exactly once in guarded picker, profile, and release allowlist', async () => {
  const [html, app, profile, release, catalog, ledger] = await Promise.all([
    read('index.html'), read('src/app.js'),
    read('example-backend-profile.json').then(JSON.parse),
    read('../.github/scripts/package-playground.mjs'),
    read('tests/example-catalog.test.mjs'), read('docs/EXAMPLE_BACKEND_PARITY.md')
  ]);
  const registered = JSON.parse(app.match(/const PREVIEW_EXAMPLES = new Set\((\[[^\n]+\])\)/)[1]);
  const runnable = JSON.parse(app.match(/const EXECUTABLE_PREVIEWS = new Set\((\[[^\n]+\])\)/)[1]);
  const inventory = JSON.parse(catalog.match(/const previews = (\[[^\n]+\]);/)[1]);
  assert.match(html, /Language previews — syntax only \(compiler diagnostics\)/);
  assert.match(app, /const verifiedExample = EXECUTABLE_PREVIEWS\.has\(linkedExample\)/);
  for (const name of names) {
    const id = 'preview/' + name;
    assert.equal(html.split('value="' + id + '"').length - 1, 1, name + ' menu');
    assert.equal(registered.filter(x => x === id).length, 1, name + ' loader');
    assert.equal(inventory.filter(x => x === name).length, 1, name + ' catalog');
    assert.equal(release.split("'examples/preview/" + name + ".atto'").length - 1, 1,
      name + ' release allowlist');
    assert.deepEqual(profile.preview.filter(x => x.name === name),
      [{ name, expect: 'preview-only' }], name + ' pinned compiler boundary');
    assert.ok(!runnable.includes(id), name + ' must never be autorun');
    assert.ok(ledger.includes(name), name + ' missing explicit unsupported ledger');
  }
  const total = profile.preview.length;
  assert.equal(total, 132);
  assert.equal(profile.preview.filter(x => x.expect === 'exec').length, 33,
    'no unverified runnable gallery promotion');
  assert.ok(ledger.includes('33 of ' + total + ' `examples/preview/*.atto`'));
  assert.ok(ledger.includes('other 99 `examples/preview/*.atto`'));
});

test('private source tests are denied by audited public publication surface', async () => {
  const [audit, packageJs] = await Promise.all([
    read('../.github/scripts/audit-live-playground.mjs'),
    read('../.github/scripts/package-playground.mjs'),
  ]);
  assert.ok(audit.includes("'/play/tests/immutable-collection-gallery.test.mjs'"));
  assert.ok(!packageJs.includes("'tests/immutable-collection-gallery.test.mjs'"));
});


test('all six immutable syntax previews fail closed against the EXACT published compiler and allow recovery', async t => {
  const { createCompiler } = await import('../src/compiler.js');
  const wasm = await readFile(new URL('../public/atto_compiler.wasm', import.meta.url));
  const receipt = JSON.parse(await read('public/atto_compiler.receipt.json'));
  const { createHash } = await import('node:crypto');
  assert.equal(wasm.byteLength, receipt.compiler_bytes, 'public compiler bytes drifted');
  assert.equal(createHash('sha256').update(wasm).digest('hex'), receipt.compiler_sha256,
    'never validate previews against an unreviewed candidate compiler');
  const compiler = await createCompiler(wasm);
  const recovery = 'pub fnc main(): int { return 42; }';
  const knownGood = compiler.compile(recovery);
  assert.equal(knownGood.ok, true, 'baseline guest must compile');
  assert.ok(WebAssembly.validate(knownGood.wasm));
  for (const name of names) await t.test(name, async () => {
    const source = await read('examples/preview/' + name + '.atto');
    const invalid = compiler.compile(source);
    assert.equal(invalid.ok, false,
      name + ' unexpectedly became runnable: require a separately reviewed oracle and release');
    assert.equal(Object.hasOwn(invalid, 'wasm'), false,
      name + ' emitted a guest despite the syntax-only contract');
    assert.match(invalid.diagnostics?.[0]?.message ?? '', /^E_[A-Z0-9_]+:/,
      name + ' must provide a compiler diagnostic, not simulated success');
    assert.ok(invalid.diagnostics[0].line >= 1 && invalid.diagnostics[0].column >= 1,
      name + ': diagnostic must identify a source position');
    const recovered = compiler.compile(recovery);
    assert.equal(recovered.ok, true, name + ' corrupted the next compile');
    assert.deepEqual(recovered.wasm, knownGood.wasm,
      name + ' changed the bytes of a subsequent valid guest');
  });
});
