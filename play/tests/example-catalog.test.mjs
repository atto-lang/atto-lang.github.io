import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = file => readFile(new URL(file, root), 'utf8');
const previews = ["boolean-operators","generators","async-iterators","tasks-async","match-values","match-types-is","use-using-with","function-pipeline","actor-pipeline","supervisor-mailbox","trap","result-option","result-option-end","channel-bounded","channel-probe","channel-unbounded","rx-observable","rx-interop"];
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
  assert.match(source, /fnc print_checked\(Result<int, String> outcome\)/);
  assert.match(source, /fnc print_trapped\(Option<Result<int, String>> outcome\)/);
  assert.match(source, /on Some\(result\) -> \{ print_checked\(result\); \}/);
  assert.match(source, /print_trapped\(success\)/);
  assert.match(source, /print_trapped\(invalid\)/);
  assert.doesNotMatch(source, /print_checked\((?:success|invalid)\)/);
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

test('alternate Result/Option functions preserve semantics and optional ::', async () => {
  const brace = await read('examples/preview/result-option.atto');
  const ended = await read('examples/preview/result-option-end.atto');
  assert.match(ended, /^\/\/ SYNTAX PREVIEW/);
  assert.match(ended, /^fnc validate_port\(int port\) -> Result<int, string>\n/m);
  assert.match(ended, /^fnc optional_port\(bool present\) -> Option<int> ::\n/m);
  assert.doesNotMatch(ended, /^fnc validate_port\(int port\) -> Result<int, string> ::/m);
  for (const token of ['return Ok(port);','return Err("port must be positive");','return None;','return Some(8080);'])
    assert.ok(ended.includes(token) && brace.includes(token), token);
  const main = 'pub fnc main(): int {';
  assert.equal(ended.slice(ended.indexOf(main)), brace.slice(brace.indexOf(main)));
  assert.equal((ended.match(/^end$/gm) || []).length, 2);
});

test('actor-pipeline preview demonstrates both actor routing spellings', async () => {
  const html = await read('index.html');
  const source = await read('examples/preview/actor-pipeline.atto');
  assert.match(html, /<option value="preview\/actor-pipeline">Actor pipelines \(\| \/ pipe keyword\)<\/option>/);
  assert.match(source, /^\/\/ PREVIEW ONLY:/);
  for (const actor of ['Parse', 'Validate', 'Sink']) {
    assert.equal(source.match(new RegExp('define actor ' + actor + ' as', 'g'))?.length, 1);
    assert.match(source, new RegExp('define actor ' + actor + ' as\\n  receive\\(ActorMail<int> mail\\): void'));
  }
  assert.match(source, /emit\(mail\.value \+ 1\)/);
  assert.match(source, /if mail\.value > 0 then emit\(mail\.value\); fi/);
  assert.match(source, /stdio\.println\(mail\.value\)/);
  const symbolic = 'val pipelineResultOne = spawn Parse() | spawn Validate() | spawn Sink();';
  const keyword = 'val pipelineResultTwo = spawn Parse() pipe spawn Validate() pipe spawn Sink();';
  assert.equal(source.split(symbolic).length - 1, 1, 'symbolic chain appears exactly once');
  assert.equal(source.split(keyword).length - 1, 1, 'keyword chain appears exactly once');
  assert.equal(source.match(/\bspawn (?:Parse|Validate|Sink)\(\)/g)?.length, 6);
  assert.match(source, /pipelineResultOne\.send\(41\);/);
  assert.match(source, /pipelineResultTwo\.send\(42\);/);
  assert.equal(source.match(/\.send\(41\);/g)?.length, 1);
  assert.equal(source.match(/\.send\(42\);/g)?.length, 1);
  assert.doesNotMatch(source, /pipelineResultTwo\.send\(41\);/);
  assert.match(source, /ordering across their Sinks is unspecified/);
  assert.doesNotMatch(source, /spawn Parse\(\) \|> spawn Validate\(\)/);
  assert.doesNotMatch(source, /\bpipe\s*\|>|\|>\s*pipe\b/);
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

test('boolean preview includes six variadic and array gate examples safely', async () => {
  const preview = await read('examples/preview/boolean-operators.atto');
  assert.match(preview, /^\/\/ PREVIEW ONLY:/);
  assert.match(preview, /val c = true;/);
  assert.match(preview, /val d = false;/);
  assert.match(preview, /variadic and array.*not yet supported by the pinned browser compiler/i);
  const calls = preview.split('\n').map(line => line.trim()).filter(line => line.startsWith('stdio.println('));
  assert.deepEqual(calls, [
    'stdio.println(a && b);',
    'stdio.println(a || b);',
    'stdio.println(a ^^ b);',
    'stdio.println(And(a, b));',
    'stdio.println(Or(a, b));',
    'stdio.println(Xor(a, b));',
    'stdio.println(And(a, b, c));',
    'stdio.println(Or(a, b, c, d));',
    'stdio.println(Xor(a, b));',
    'stdio.println(And([a, b, c]));',
    'stdio.println(Or([a, b, c, d]));',
    'stdio.println(Xor([a, b]));',
  ]);
  assert.match(preview, /^  \/\/ stdio\.println\(a AND b\);$/m);
  assert.match(preview, /^  \/\/ stdio\.println\(a OR b\);$/m);
  assert.match(preview, /^  \/\/ stdio\.println\(a XOR b\);$/m);
});
