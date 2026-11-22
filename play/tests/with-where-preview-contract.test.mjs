import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');
const names = [
  'with-scoped-deadlines',
  'with-refined-integers',
  'with-refined-strings',
  'where-generic-future',
  'where-type-bounds'
];

test('with/where examples are visible, packaged and explicitly non-executable', async () => {
  const [html, app, profile, packager] = await Promise.all([
    read('index.html'),
    read('src/app.js'),
    read('example-backend-profile.json').then(JSON.parse),
    read('../.github/scripts/package-playground.mjs')
  ]);
  const previewSet = JSON.parse(app.match(/const PREVIEW_EXAMPLES = new Set\((\[[^\n]+\])\)/)[1]);
  const execSet = JSON.parse(app.match(/const EXECUTABLE_PREVIEWS = new Set\((\[[^\n]+\])\)/)[1]);
  for (const name of names) {
    assert.match(html, new RegExp('<option value="preview/' + name + '">'));
    assert.ok(previewSet.includes('preview/' + name), name + ': missing from guarded catalog');
    assert.ok(!execSet.includes('preview/' + name), name + ': must not be autorun');
    assert.deepEqual(profile.preview.find(x => x.name === name), {name, expect: 'preview-only'});
    assert.ok(packager.includes("'examples/preview/" + name + ".atto'"), name + ': not packaged');
    const source = await read('examples/preview/' + name + '.atto');
    assert.match(source, /(?:SYNTAX|DESIGN) PREVIEW/);
    assert.match(source, /NOT (?:supported|browser-lowered|an executable example)/);
  }
});

test('with is scoped, where is a static trait/type bound', async () => {
  const withSource = await read('examples/preview/with-scoped-deadlines.atto');
  const generic = await read('examples/preview/where-generic-future.atto');
  const type = await read('examples/preview/where-type-bounds.atto');
  assert.match(withSource, /using span\(/);
  assert.match(withSource, /with timeout\(2000\)/);
  assert.match(withSource, /with timeout\(100\)/);
  assert.match(generic, /where F: HasFuture<T>/);
  assert.match(generic, /return await operation/);
  assert.match(type, /where T: Printable/);
  assert.match(type, /where T: Sendable/);
  assert.match(type, /implements Trait/);
});


test('with refinements distinguish built-in value/length bounds from where witnesses', async () => {
  const ints = await read('examples/preview/with-refined-integers.atto');
  const strings = await read('examples/preview/with-refined-strings.atto');
  assert.match(ints, /define type X = int with value > 3 and value <= 4;/);
  assert.match(ints, /declare type OnlyFour = int with min 4 and max 4;/);
  assert.match(ints, /define type Port = int with min 1 and max 65535;/);
  assert.match(ints, /X\.try_from\(4\)/);
  assert.match(ints, /X\.try_from\(5\)/);
  assert.match(strings, /define type Z = string with length < 4 and length > 1;/);
  assert.match(strings, /min_length 3 and max_length 32/);
  assert.match(strings, /chars ascii_letters/);
  assert.match(strings, /Unicode code points/);
  assert.match(strings, /Z\.try_from\("é😀"\)/);
});
