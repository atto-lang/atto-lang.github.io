import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = file => readFile(new URL(file, root), 'utf8');
const previews = ["boolean-operators","generators","async-iterators","tasks-async","match-values","match-types-is","use-using-with","function-pipeline","actor-pipeline","supervisor-mailbox","trap","result-option","channel-bounded","channel-probe","channel-unbounded","rx-observable","rx-interop"];
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
    assert.match(source, /^\/\/ (?:PREVIEW ONLY:|SYNTAX PREVIEW)/);
    assert.match(source, /fnc main\(\)/);
  }
});
test('define supervisor preview is discoverable but never advertised as executable', async () => {
  const html = await read('index.html');
  const source = await read('examples/preview/supervisor-mailbox.atto');
  assert.match(html, /<option value="preview\/supervisor-mailbox">define supervisor — mailbox ping-pong<\/option>/);
  assert.match(source, /define supervisor PingPong as/);
  assert.match(source, /^\/\/ PREVIEW ONLY:/);
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

test('trap preview uses caller-side trap expression with Option<Result> typing', async () => {
  const source = await read('examples/preview/trap.atto');
  assert.match(source, /fnc checked_id\(int id\): Result<int, String>/);
  assert.doesNotMatch(source, /\btrap\s+fnc\b/);
  assert.match(source, /fnc print_checked\(Option<Result<int, String>> outcome\)/);
  assert.match(source, /Option<Result<int, String>> success = trap checked_id\(5\)/);
  assert.match(source, /Option<Result<int, String>> invalid = trap checked_id\(-1\)/);
  assert.match(source, /return Err\("id must be nonnegative"\)/);
  assert.match(source, /return Ok\(id\)/);
  assert.match(source, /match outcome over/);
  assert.match(source, /on Some\(result\)/);
  assert.match(source, /on None/);
  assert.match(source, /on Ok\(id\)/);
  assert.match(source, /on Err\(message\)/);
  assert.match(source, /Some\(Err\(/);
  assert.doesNotMatch(source, /\btrap\s+["']/);
  assert.doesNotMatch(source, /fatal fault|guest trap boundary/i);
});

