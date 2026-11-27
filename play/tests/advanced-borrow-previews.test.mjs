// Static evidence only: these are language-contract sketches, not compiler acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createCompiler } from '../src/compiler.js';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');
const cases = new Map([
  ['borrow-disjoint-fields', ['borrow! person.name', 'borrow! mut person.age', 'take! person']],
  ['borrow-nll-control-flow', ['left_view', 'select_left', 'defer', 'last *possible* use']],
  ['borrow-method-effects', ['increment_total', 'verified disjoint effects', 'unknown callback']],
  ['borrow-actor-state-projections', [
    'Meter mut self.state.counter',
    'Meter mut self.state.{counter, xyz}',
    'critical-write', 'critical-read', 'no parallel writers implied'
  ]],
  ['borrow-actor-named-receivers', [
    'Meter this', 'Meter mut self.state.counter',
    'Meter mut this.state.counter', 'Meter mut node.state.{counter, xyz}',
    'critical-read', 'critical-write', 'not the actor ABI'
  ]]
]);

test('all advanced borrow cases are catalogued, packaged and explicitly diagnostic-only', async () => {
  const [html, app, profile, release, audit, catalog] = await Promise.all([
    read('index.html'), read('src/app.js'), read('example-backend-profile.json').then(JSON.parse),
    read('../.github/scripts/package-playground.mjs'),
    read('../.github/scripts/audit-live-playground.mjs'),
    read('tests/example-catalog.test.mjs')
  ]);
  const preview = JSON.parse(app.match(/const PREVIEW_EXAMPLES = new Set\((\[[^\n]+\])\)/)[1]);
  const executable = JSON.parse(app.match(/const EXECUTABLE_PREVIEWS = new Set\((\[[^\n]+\])\)/)[1]);
  const group = html.match(/<optgroup label="Language previews — syntax only \(compiler diagnostics\)">([\s\S]*?)<\/optgroup>/);
  assert.ok(group, 'syntax-only dropdown group missing');
  for (const name of cases.keys()) {
    const id = 'preview/' + name;
    assert.equal(preview.filter(value => value === id).length, 1, name + ' registered once');
    assert.equal(html.split('value="' + id + '"').length - 1, 1, name + ' dropdown once');
    assert.ok(group[1].includes('value="' + id + '"'), name + ' not in syntax-only group');
    assert.equal(executable.includes(id), false, name + ' prematurely advertised as executable');
    assert.deepEqual(profile.preview.find(value => value.name === name),
      { name, expect: 'preview-only' });
    assert.equal(release.split("'examples/preview/" + name + ".atto'").length - 1, 1,
      name + ' must be on protected asset allowlist once');
    assert.ok(catalog.includes('"' + name + '"'), name + ' missing from catalog inventory');
  }
  assert.ok(audit.includes("'/play/tests/advanced-borrow-previews.test.mjs'"),
    'new internal regression file must be denied by production HTTP postflight');
});

test('the advanced examples explain conflicting borrows and never execute bad cases', async () => {
  for (const [name, tokens] of cases) {
    const source = await read('examples/preview/' + name + '.atto');
    assert.match(source, /^\/\/ SYNTAX PREVIEW — NOT browser-lowered/);
    assert.match(source, /pub fnc main\(\): int/);
    assert.match(source, /NOT browser|NOT pinned|NOT browser-lowered|NOT browser execution|not browser|unverified|target/i);
    const invalid = source.split('\n').filter(line => line.includes('INVALID:'));
    assert.ok(invalid.length >= 5, name + ' must include at least five negative examples');
    for (const line of invalid) assert.match(line, /^\s*\/\/ INVALID:/,
      name + ' accidentally activated an invalid example');
    for (const token of tokens) assert.ok(source.includes(token), name + ' lacks '+token);
    assert.doesNotMatch(source, /<script\b|^#include\b/m);
  }
});

test('actor state permissions are not confused with independently lockable fields', async () => {
  const source = await read('examples/preview/borrow-actor-state-projections.atto');
  assert.match(source, /STATIC write-permission ceiling/);
  assert.match(source, /whole-state exclusive critical-write/);
  assert.match(source, /INVALID: self.state.counter \+= 1/);
  assert.match(source, /INVALID: await next_value\(\)/);
  assert.match(source, /INVALID:.*s\.other/);
});

test('named receiver preview is byte-identical to the tested compiler fixture', async () => {
  const source = await read('examples/preview/borrow-actor-named-receivers.atto');
  // Exact Git blob SHA from atto-source.rs#488 Rust fixture and the successful
  // 81-blob private CI snapshot. The frontend approves parsing only.
  const blob = createHash('sha1')
    .update('blob ' + Buffer.byteLength(source) + '\0').update(source).digest('hex');
  assert.equal(blob, '1b90ccfa037c2976fb91170cdc2eeac3bf3184b5');
  assert.match(source, /mtd \(Meter this\) receive\(\): void/);
  assert.match(source, /mtd \(Meter mut self\.state\.counter\) increment/);
  assert.match(source, /mtd \(Meter mut this\.state\.counter\) increment_using_this/);
  assert.match(source, /mtd \(Meter mut node\.state\.\{counter, xyz\}\) update_both/);
  assert.match(source, /critical-write remains whole-state exclusive/i);
  assert.match(source, /NOT browser-lowered/);
  for (const forbidden of [
    'this.send(this.state.counter)',
    'this.send(this)',
    'critical-read |s| -> { ++s.counter; }',
    's.xyz.inner = 1;',
  ]) {
    assert.ok(source.split('\n').some(line => line.startsWith('// INVALID:') &&
      line.includes(forbidden)), 'missing documented negative: ' + forbidden);
  }
});

test('pinned Rust/Wasm compiler denies exact named receiver preview and adversarial edits', async t => {
  const [source, binary, receipt] = await Promise.all([
    read('examples/preview/borrow-actor-named-receivers.atto'),
    readFile(new URL('public/atto_compiler.wasm', root)),
    read('public/atto_compiler.receipt.json').then(JSON.parse)
  ]);
  assert.equal(binary.length, receipt.compiler_bytes, 'browser compiler size receipt changed');
  assert.equal(createHash('sha256').update(binary).digest('hex'),
    receipt.compiler_sha256, 'browser compiler bytes were repinned without review');
  const compiler = await createCompiler(binary);
  const cases = [
    ['exact-parser-proven-source', source],
    ['nested-sealed-read', source.replace('this.send(41);', 'this.send(this.state.counter);')],
    ['escaped-receiver', source.replace('this.send(41);', 'this.send(this);')],
    ['unguarded-state-write', source.replace('this.send(41);', 'this.state.counter = 1;')],
    ['out-of-ceiling-write', source.replace('s.xyz = 3;', 's.other = 3;')],
    ['readonly-prefix-write', source.replace(
      'critical-read |s| -> s.counter', 'critical-read |s| -> ++s.counter')],
    ['receiver-name-mismatch', source.replace('this.send(41);', 'self.send(41);')]
  ];
  const recovery = 'pub fnc main(): int { return 42; }';
  for (const [name, candidate] of cases) {
    await t.test(name, () => {
      if (name !== 'exact-parser-proven-source') {
        assert.notEqual(candidate, source, name + ': mutation silently failed');
      }
      const rejected = compiler.compile(candidate);
      assert.equal(rejected.ok, false, name + ': unreviewed actor guest accepted');
      assert.equal(Object.hasOwn(rejected, 'wasm'), false, name + ': rejected guest bytes exposed');
      assert.match(rejected.diagnostics?.[0]?.message ?? '', /^E_(?!SOURCE_LIMIT)[A-Z0-9_]+:/,
        name + ': require a real compiler diagnostic, not a length-only rejection');
      assert.ok(rejected.diagnostics[0].line >= 1 && rejected.diagnostics[0].column >= 1,
        name + ': missing precise source location');
      const valid = compiler.compile(recovery);
      assert.equal(valid.ok, true, name + ': rejected sample poisoned the compiler');
      assert.ok(valid.wasm instanceof Uint8Array && WebAssembly.validate(valid.wasm),
        name + ': recovery must emit a valid WebAssembly guest');
    });
  }
});

test('named receiver preview is visibly labelled non-executable without disabling diagnostics', async () => {
  const [app, html, profile] = await Promise.all([
    read('src/app.js'), read('index.html'),
    read('example-backend-profile.json').then(JSON.parse)
  ]);
  assert.match(app, /Language preview — syntax only with the pinned Rust\/Wasm compiler/);
  assert.match(app, /no actor guest is claimed/);
  assert.match(app, /supportLabel\.dataset\.support = 'preview'/);
  assert.match(app, /runButton\.disabled = controlsDisabled/);
  assert.match(app, /compileButton\.disabled = controlsDisabled/);
  const slug = 'borrow-actor-named-receivers';
  assert.deepEqual(profile.preview.find(x => x.name === slug), { name: slug, expect: 'preview-only' });
  assert.equal(html.split('value="preview/' + slug + '"').length - 1, 1);
  assert.ok(!app.match(/const EXECUTABLE_PREVIEWS = new Set\((\[[^\n]+\])\)/)[1]
    .includes('"preview/' + slug + '"'), 'syntax preview must not be executable');
});
