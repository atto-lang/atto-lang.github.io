// Catalog and semantic teaching checks only; this is NOT guest conformance.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');
const slug = 'collection-literal-shapes';
const id = 'preview/' + slug;

test('collection gallery reflects current literal, binding and nominal-product contracts', async () => {
  const source = await read('examples/preview/' + slug + '.atto');
  assert.match(source, /^\/\/ SYNTAX PREVIEW — NOT browser-lowered/);
  for (const token of [
    'let string x = "hi";',
    'let Map<string, string> empty_map = {};',
    'let Map<string, string> g = {',
    '"5" => "foo",',
    'x => "bar"',
    'let Map<string, int> scores = {',
    '"alice": 10,',
    "'bob' => 20",
    'let Pair<string, string> p = Pair.of("x", "y");',
    'let Entry<string, string> e = "x" => "y";',
    'let Record m = (name="foo", bar=5, star=true);',
    'let Record n = {name: "foo", bar: 5, star: true};',
    'let List<bool> l = [true, true, false];',
    'let List<string> empty_list = [];',
    'let Array<int> a = [1, 2, 3];',
    'let tuple = (7, "paid");',
    'let entries = ["x" => "y", "a" => "b"];',
    'let Map<string, int> from_entries = Map.of_entries<string, int>(',
    '"first" => 1,',
    'Entry.of("second", 2)',
    '[x] is a one-element List/Array expression, NOT a computed-key marker',
  ]) assert.ok(source.includes(token), 'missing collection case: ' + token);
  for (const invalid of [
    'let Map<string, string> bad = {"5" => "foo", [x] => "bar"};',
    'let ambiguous_map = {};',
    'let ambiguous_list = [];',
    'let mixed = {name: "foo", "x" => "bar"};',
    'let Record wrong = {"name": "foo"};',
    'let broken = (name="foo", 5);',
    'let bad_pair = Pair.of();',
  ]) assert.ok(source.includes('// INVALID: ' + invalid), 'missing invalid case: ' + invalid);
  assert.match(source, /quoted field names form a Map/);
  assert.match(source, /let is a rebindable binding; mut controls referent mutation/);
  assert.match(source, /^\/\/ TYPE CONTEXT: let Map f = \{\};/m);
  assert.doesNotMatch(source, /^\s*let\s+Map\s+\w+\s*=\s*\{\};/m, 'never present ambiguous {} as valid');
});

test('collection gallery is wired once, packaged once and remains diagnostic-only', async () => {
  const [html, app, profile, release, catalog] = await Promise.all([
    read('index.html'), read('src/app.js'),
    read('example-backend-profile.json').then(JSON.parse),
    read('../.github/scripts/package-playground.mjs'),
    read('tests/example-catalog.test.mjs')
  ]);
  assert.equal(html.split('value="' + id + '"').length - 1, 1);
  assert.match(html, /Language previews — syntax only \(compiler diagnostics\)/);
  const menu = html.match(/<optgroup label="Language previews — syntax only \(compiler diagnostics\)">([\s\S]*?)<\/optgroup>/);
  assert.ok(menu && menu[1].includes('value="' + id + '"'));
  const available = JSON.parse(app.match(/const PREVIEW_EXAMPLES = new Set\((\[[^\n]+\])\)/)[1]);
  const executable = JSON.parse(app.match(/const EXECUTABLE_PREVIEWS = new Set\((\[[^\n]+\])\)/)[1]);
  assert.equal(available.filter(x => x === id).length, 1);
  assert.ok(!executable.includes(id));
  assert.deepEqual(profile.preview.filter(x => x.name === slug), [{name: slug, expect: 'preview-only'}]);
  assert.equal(release.split("'examples/preview/" + slug + ".atto'").length - 1, 1);
  const inventory = JSON.parse(catalog.match(/const previews = (\[[^\n]+\]);/)[1]);
  assert.equal(inventory.filter(x => x === slug).length, 1);
});

test('legacy collection previews agree on Map versus Record and nominal Entry contracts', async () => {
  const [inline, products, factories, collections] = await Promise.all([
    read('examples/preview/collections-inline-literals.atto'),
    read('examples/preview/struct-record-pair-entry.atto'),
    read('examples/preview/collection-factories.atto'),
    read('examples/preview/collections.atto'),
  ]);
  for (const [src, expected] of [
    [inline, [
      'let Map<string, int> map = {"apple": 3, key => 5};',
      'let Record record = {answer: 42, ready: true};',
      'let Record record_paren = (answer=42, ready=true);',
      'let Array<int> array = [1, 2, 3];',
      'let List<int> empty_list = [];',
      'let Map<string, int> empty_map = {};',
      'INVALID: let Record wrong = {"answer": 42};',
      'INVALID: let Map<string, int> wrong_key = {[key] => 5};',
    ]],
    [products, [
      'let Record record = {id: 7, status: "paid"};',
      'let Record record_paren = (id=7, status="paid");',
      'let Pair<string, int> pair = Pair.of("widgets", 2);',
      'let Entry<string, int> entry = Entry.of("widgets", 2);',
      'let Entry<string, int> arrow = "widgets" => 2;',
      'let Map<string, int> map = {"widgets" => 2};',
      'INVALID: let Record wrong2 = {id => 7};',
      'INVALID: let Entry<string, int> wrong = Pair.of("widgets", 2);',
    ]],
    [factories, [
      'let map = Map.of("answer", 42);',
      'let pair = Pair.of("widgets", 2);',
      'let entry = Entry.of("key", 7);',
      'let from_entries = Map.of_entries<string, int>(entry, arrow);',
      'INVALID: Map.of_entries(Pair.of("answer", 42));',
    ]],
    [collections, [
      'let Record item = (name="Atto", count=3);',
      'let Map<string, int> score_literals = {"a" => 10, "b": 20};',
      'let Map<string, int> from_entries = Map.of_entries<string, int>(',
      'INVALID: let Record bad = {"name": "Atto"};',
    ]],
  ]) {
    for (const expectedLine of expected)
      assert.ok(src.includes(expectedLine), 'missing canonical literal spelling: ' + expectedLine);
  }
  assert.doesNotMatch(collections, /Record\.of\(/, 'deprecated/unverified Record factory example');
  assert.doesNotMatch(products, /^\/\/ INVALID: \{id => 7\} interpreted as Record/m,
    'dynamic map key expression must not be described as a Record');
  assert.match(inline, /^\/\/ SYNTAX PREVIEW — NOT browser-lowered/);
  assert.match(products, /^\/\/ SYNTAX PREVIEW — NOT browser-lowered/);
  assert.match(factories, /^\/\/ SYNTAX PREVIEW — NOT browser-lowered/);
  assert.match(collections, /^\/\/ PREVIEW ONLY:/);
});
