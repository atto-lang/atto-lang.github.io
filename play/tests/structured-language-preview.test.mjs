import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');
const names = ["modules","namespaces","stdio-channels","traits-interfaces","data-shapes"];

test('preview additions are discoverable, shipped exactly once and non-executable', async () => {
  const [html, app, release] = await Promise.all([
    read('index.html'), read('src/app.js'), read('../.github/scripts/package-playground.mjs')
  ]);
  assert.match(html, /Language previews — not executable yet/);
  assert.match(app, /runButton\.disabled = controlsDisabled/);
  assert.match(app, /formatButton\.disabled = value \|\| PREVIEW_EXAMPLES\.has\(selector\.value\)/);
  for (const name of names) {
    assert.equal(html.split('value="preview/' + name + '"').length - 1, 1);
    assert.equal(app.split('"preview/' + name + '"').length - 1, 1);
    assert.equal(release.split("'examples/preview/" + name + ".atto'").length - 1, 1);
    const source = await read('examples/preview/' + name + '.atto');
    assert.match(source, /^\/\/ SYNTAX PREVIEW/);
    assert.match(source, /fnc main\(\): int/);
    assert.doesNotMatch(source, /\.ores\b/);
  }
});

test('modules and namespaces show visibility, imports and explicit/implicit lookup', async () => {
  const [a,b] = await Promise.all([read('examples/preview/modules.atto'),read('examples/preview/namespaces.atto')]);
  for (const value of ['define pub module Arithmetic as','define module Internal as','pub fnc double(int value)','Arithmetic.double(21)'])
    assert.ok(a.includes(value), value);
  for (const value of ['use +lib/math;','use namespace math;','square(7)','math.square(8)'])
    assert.ok(b.includes(value), value);
  assert.match(b, /separate file is not in this playground/);
});

test('stdio examples treat input and output as channels with one input consumer', async () => {
  const s = await read('examples/preview/stdio-channels.atto');
  for (const value of ['pub suspends fnc main()', 'stdio.in', 'stdio.out', 'stdio.err', 'writech output,','readch input', 'writech output, item','stdio.in.stream()'])
    assert.ok(s.includes(value), value);
  assert.match(s, /not readch and stream\(\) concurrently/);
  assert.match(s, /byte\/text encoding is target-specific/);
});

test('traits differ from interfaces, and five data shapes are represented', async () => {
  const [t,s] = await Promise.all([read('examples/preview/traits-interfaces.atto'),read('examples/preview/data-shapes.atto')]);
  assert.match(t, /define pub interface Named as[\s\S]*name\(\): string;/);
  assert.match(t, /define pub trait Greeter as[\s\S]*greet\(\): string \{/);
  assert.match(t, /implements Named, Greeter/);
  assert.match(t, /method conflicts and override precedence need compiler tests/);
  for (const value of ['define struct Point as','define record Receipt as','infer struct{','Tuple<int, string>','Pair<string, int>','Entry<string, int>'])
    assert.ok(s.includes(value), value);
  assert.match(s, /nominal\/equality policy needs conformance/);
  assert.match(s, /illustrative/);
});
