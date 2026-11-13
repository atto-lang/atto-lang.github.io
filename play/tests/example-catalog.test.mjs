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
  assert.match(html, /<option value="preview\/generators">Generators \(\*gen \/ yield\)<\/option>/);
  assert.match(source, /^\/\/ PREVIEW ONLY:/);
  assert.match(source, /fnc \*gen count_to\(int limit\): Generator<int> \{/);
  assert.doesNotMatch(source, /(?:^|\n)fnc count_to\(/);
  assert.match(source, /yield i;/);
  assert.match(source, /for value in count_to\(4\) do/);
  assert.match(source, /stdio\.println\(sum\); \/\/ 10/);
});
 
test('actor-pipeline preview demonstrates both actor routing spellings', async () => {
  const html = await read('index.html');
  const source = await read('examples/preview/actor-pipeline.atto');
  assert.match(html, /<option value="preview\/actor-pipeline">/);
  assert.match(source, /^\/\/ PREVIEW ONLY:/);
  for (const actor of ['Parse', 'Validate', 'Sink']) {
    assert.equal(source.match(new RegExp('define actor ' + actor + ' as', 'g'))?.length, 1);
    assert.match(source, new RegExp('define actor ' + actor + ' as\\n  receive\\(ActorMail<int> mail\\): void'));
  }
  assert.match(source, /emit\(mail\.value \+ 1\)/);
  assert.match(source, /if mail\.value > 0 then emit\(mail\.value\); fi/);
  assert.match(source, /stdio\.println\(mail\.value\)/);
  const symbolic = 'val pipeline_symbols = spawn Parse() | spawn Validate() | spawn Sink();';
  const keyword = 'val pipeline_keyword = spawn Parse() pipe spawn Validate() pipe spawn Sink();';
  assert.equal(source.split(symbolic).length - 1, 1, 'symbolic chain appears exactly once');
  assert.equal(source.split(keyword).length - 1, 1, 'keyword chain appears exactly once');
  assert.equal(source.match(/\bspawn (?:Parse|Validate|Sink)\(\)/g)?.length, 6);
  assert.match(source, /pipeline_symbols\.send\(41\);/);
  assert.match(source, /pipeline_keyword\.send\(41\);/);
  assert.equal(source.match(/\.send\(41\);/g)?.length, 2);
  assert.match(source, /ordering across their Sinks is unspecified/);
  assert.doesNotMatch(source, /spawn Parse\(\) \|> spawn Validate\(\)/);
  assert.doesNotMatch(source, /\bpipe\s*\|>|\|>\s*pipe\b/);
});
