import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = file => readFile(new URL(file, root), 'utf8');
const previews = ["boolean-operators","generators","async-iterators","tasks-async","match-values","match-types-is","use-using-with","function-pipeline","actor-pipeline","supervisor-mailbox"];
test('every preview dropdown option has a safe .atto source and a clear warning', async () => {
  const html = await read('index.html');
  const app = await read('src/app.js');
  assert.match(html, /Language previews — not executable yet/);
  const menu = [...html.matchAll(/<option value="preview\/([a-z-]+)"/g)].map(match => match[1]);
  assert.deepEqual(menu, previews, 'dropdown previews must exactly match the catalog');
  const registered = app.match(/const PREVIEW_EXAMPLES = new Set\((\[[^\n]+\])\)/);
  assert.ok(registered, 'missing explicit preview allowlist');
  assert.deepEqual(JSON.parse(registered[1]), previews.map(name => 'preview/' + name));
  assert.match(app, /onSelectionChange: updateExampleSupport/);
  assert.match(app, /runButton\.disabled = controlsDisabled/);
  const release = await read('../.github/scripts/package-playground.mjs');
  for (const name of previews) {
    assert.ok(html.includes('value="preview/' + name + '"'), name + ' dropdown missing');
    assert.ok(app.includes('"preview/' + name + '"'), name + ' loader missing');
    assert.equal(release.split("'examples/preview/" + name + ".atto'").length - 1, 1, name + ' absent or duplicate in release allowlist');
    const source = await read('examples/preview/' + name + '.atto');
    assert.match(source, /^\/\/ PREVIEW ONLY:/);
    assert.match(source, /fnc main\(\)/);
  }
});
test('boolean samples never advertise comma/pipe as logical AND/OR', async () => {
  const runnable = await read('examples/conditions.atto');
  const preview = await read('examples/preview/boolean-operators.atto');
  assert.match(runnable, /if And\(/);
  assert.match(runnable, /if Or\(/);
  assert.doesNotMatch(runnable, /if a > 0, b > 0|if even\(a\) \| even\(b\)/);
  assert.match(preview, /&&/);
  assert.match(preview, /\|\|/);
  assert.match(preview, /\^\^/);
  for (const name of ['And(', 'Or(', 'Xor(', ' AND ', ' OR ', ' XOR ']) {
    assert.ok(preview.includes(name), name);
  }
});
