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
  const html = await read('index.html');
  assert.match(html, /<option value="preview\/trap">trap expression — Option \/ Result<\/option>/);
  assert.doesNotMatch(html, /Trap \/ fatal fault/);
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
  assert.match(source, /Some\(Ok\(5\)\)/);
  assert.match(source, /Some\(Err\(/);
  assert.match(source, /an ordinary throw was caught/);
  assert.match(source, /raise, panic and cancellation bypass trap/);
  assert.doesNotMatch(source, /\btrap\s+["']/);
  assert.doesNotMatch(source, /fatal fault|guest trap boundary/i);
});


test('generator preview requires explicit *gen and does not claim browser execution', async () => {
  const html = await read('index.html');
  const source = await read('examples/preview/generators.atto');
  assert.match(html, /<option value="preview\/generators">Generators \(\*gen \/ yield \/ yield\*\)<\/option>/);
  assert.match(source, /^\/\/ PREVIEW ONLY:/);
  assert.match(source, /fnc \*gen count_to\(int limit\): Generator<int> \{/);
  assert.doesNotMatch(source, /(?:^|\n)fnc count_to\(/);
  assert.match(source, /yield i;/);
  assert.match(source, /fnc \*gen count_with_zero\(int limit\): Generator<int>/);
  assert.match(source, /yield 0;/);
  assert.match(source, /yield\* count_to\(limit\);/);
  assert.doesNotMatch(source, /yield \* count_to/);
  assert.match(source, /for value in count_with_zero\(4\) do/);
  assert.match(source, /stdio\.println\(sum\); \/\/ 10/);
});

test('match value preview contrasts block and expression arms and calls both functions', async () => {
  const source = await read('examples/preview/match-values.atto');
  const html = await read('index.html');
  assert.match(source, /^\/\/ PREVIEW ONLY:/);
  assert.match(html, /<option value="preview\/match-values">Match: values and guards<\/option>/);
  assert.match(source, /fnc classify\(int value\): int \{\s*match value over/);
  for (const arm of [
    'on 0 -> { return 0; }',
    'on 1 -> { return 1; }',
    'on n when n > 1 -> { return 2; }',
    'on _ -> { return -1; }',
  ]) {
    assert.ok(source.includes(arm), 'block-return arm missing: ' + arm);
  }
  assert.match(source, /fnc xyx\(int value\): int \{\s*match value over/);
  for (const arm of [
    'on 0 -> 0,',
    'on 1 -> 1,',
    'on n when n > 1 -> 2,',
    'on _ -> -1,',
  ]) {
    assert.ok(source.includes(arm), 'expression arm missing: ' + arm);
  }
  assert.match(source, /stdio\.println\(classify\(7\)\);/);
  assert.match(source, /stdio\.println\(xyx\(7\)\);/);
  assert.match(source, /return 0;/);
  assert.match(source, /expression-arm form.*not runnable/);
});
