// Catalog and semantic teaching checks only; this is NOT guest conformance.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');
const slug = 'collection-literal-shapes';
const id = 'preview/' + slug;

test('collection literals gallery teaches Map, Record, Pair, Entry and List without misclassifying [x]', async () => {
  const source = await read('examples/preview/' + slug + '.atto');
  assert.match(source, /^\/\/ SYNTAX PREVIEW — NOT browser-lowered/);
  for (const line of [
    'let string x = "hi";',
    'let Map<string, string> f = {};',
    'let g = {"5" => "foo", x => "bar"};',
    'let Pair<string, string> p = Pair.of("x", "y");',
    'let Entry<string, string> e = "x" => "y";',
    'let Record m = (name="foo", bar=5, star=true);',
    'let List<bool> l = [true, true, false];',
    'let Array<int> a = [1, 2, 3];',
    'let tuple = (7, "paid");',
    'let Map<string, int> scores = {"alice" => 10, "bob" => 20};',
    'let entries = ["x" => "y", "a" => "b"];',
  ]) assert.ok(source.includes(line), 'missing shape case: ' + line);
  assert.match(source, /^\/\/ INVALID: let bad = \{"5" => "foo", \[x\] => "bar"\};/m);
  assert.match(source, /\[x\] is List<string>, not string/);
  assert.match(source, /^\/\/ INVALID: let ambiguous = \{\};/m);
  assert.match(source, /^\/\/ INVALID: let mixed = /m);
  assert.match(source, /^\/\/ INVALID: let broken = /m);
  assert.match(source, /^\/\/ TYPE CONTEXT: let Map f = \{\};/m);
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
