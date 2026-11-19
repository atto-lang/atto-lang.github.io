import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const root = new URL('../', import.meta.url);
const read = file => readFile(new URL(file, root), 'utf8');
const profile = JSON.parse(await read('example-backend-profile.json'));
// Previews with an exec oracle (executed in pinned-preview-admission.test.mjs).
const EXEC = new Set(profile.preview.filter(x => x.expect === 'exec').map(x => x.name));
const RUNS = /^\/\/ LANGUAGE PREVIEW — compiles and runs in this browser playground\./;
const header = (name, source) => EXEC.has(name)
  ? assert.match(source, RUNS, name)
  : assert.match(source, /^\/\/ (?:PREVIEW ONLY:|SYNTAX PREVIEW)/, name);
const registeredCount = (app, name) => JSON.parse(
  app.match(/const PREVIEW_EXAMPLES = new Set\((\[[^\n]+\])\)/)[1]).filter(x => x === 'preview/' + name).length;
const previews = ["binary-data","bitwise","pointers","pipe-rpipe","functional-pipelines","channel-operators","collections","supervisor-boundaries","nested-actors","http-fs","permissions","actor-isolation","annotations","ownership","typed-messages","error-propagation","pattern-collections","concurrency","boolean-operators","generators","async-iterators","tasks-async","match-values","fib-match","match-types-is","use-using-with","modules","namespaces","actor-receiver-methods","stdio-channels","traits-interfaces","diamond-inheritance","data-shapes","effects","lexical-scope-pure","suspends","nio-reactor","mutex-locks","mutable-state","state-containers","borrow-checking","borrow-arc-send-atomic-box","guard","lambdas","lambdas-advanced","closures-functors","routine","callable-body-styles","visibility-modifiers","function-pipeline","actor-pipeline","supervisor-mailbox","trap","defer-recover","result-option","result-option-end","channel-bounded","channel-probe","channel-unbounded","rx-observable","rx-interop"];
test('every preview dropdown option has a safe .atto source and a clear warning', async () => {
  const html = await read('index.html');
  const app = await read('src/app.js');
  assert.match(html, /<optgroup label="Examples">/);
  assert.match(html, /<optgroup label="Language showcase — executable in browser">/);
  assert.match(html, /Language previews — syntax only \(compiler diagnostics\)/);
  const menu = [...html.matchAll(/<option value="preview\/([a-z-]+)"/g)].map(match => match[1]);
  assert.deepEqual([...menu].sort(), [...previews].sort(), 'dropdown previews must exactly match the catalog');
  const registered = app.match(/const PREVIEW_EXAMPLES = new Set\((\[[^\n]+\])\)/);
  assert.ok(registered, 'missing explicit preview allowlist');
  assert.deepEqual(JSON.parse(registered[1]), previews.map(name => 'preview/' + name));
  assert.match(app, /onSelectionChange: updateExampleSupport/);
  assert.match(app, /runButton\.disabled = controlsDisabled/);
  assert.match(app, /compileButton\.disabled = controlsDisabled/);
  const release = await read('../.github/scripts/package-playground.mjs');
  for (const name of previews) {
    assert.ok(html.includes('value="preview/' + name + '"'), name + ' dropdown missing');
    assert.ok(app.includes('"preview/' + name + '"'), name + ' loader missing');
    assert.equal(release.split("'examples/preview/" + name + ".atto'").length - 1, 1, name + ' absent or duplicate in release allowlist');
    const source = await read('examples/preview/' + name + '.atto');
    header(name, source);
    assert.match(source, /fnc main\(\)/);
  }
});
test('callable body preview covers fnc, routine, inline and mtd forms and runs in the browser', async () => {
  const source = await read('examples/preview/callable-body-styles.atto');
  const html = await read('index.html');
  assert.ok(html.includes('<option value="preview/callable-body-styles">Callable bodies — fnc / routine / inline / mtd</option>'));
  header('callable-body-styles', source);
  for (const header of [
    'fnc colon_braces() : int {',
    'fnc colon_arrow_braces() : int -> {',
    'fnc arrow_braces() -> int {',
    'fnc arrow_end() -> int\n',
    'fnc arrow_delimited() -> int ::',
    'routine routine_colon() : int {',
    'routine routine_colon_arrow() : int -> {',
    'routine routine_arrow() -> int {',
    'routine routine_end() -> int\n',
    'routine routine_delimited() -> int ::',
    'method inline_colon() : int {',
    'fnc inline_colon_arrow() : int -> {',
    'inline_arrow() -> int {',
    'inline_end() -> int\n',
    'inline_delimited() -> int ::',
    'mtd (self: Calculator) receiver_colon() : int {',
    'mtd (self: Calculator) receiver_colon_arrow() : int -> {',
    'mtd (self: Calculator) receiver_arrow() -> int {',
    'mtd (self: Calculator) receiver_end() -> int\n',
    'mtd (self: Calculator) receiver_delimited() -> int ::'
  ]) assert.ok(source.includes(header), 'missing body style: ' + header);
  assert.equal(source.split('mtd (self: Calculator)').length - 1, 5);
  assert.ok(source.includes('let int x = 3, x + 2'));
  assert.ok(!source.includes('pinned playground Wasm compiler cannot execute'));
  // Private access remains enforced by the compiler. The two methods
  // actually invoked from main must be public in this published source.
  assert.ok(source.includes('  pub inline_end() -> int\n'));
  assert.ok(source.includes('pub mtd (self: Calculator) receiver_end() -> int\n'));
  assert.ok(source.includes('bounded immutable class profile'));
  assert.ok(!source.includes('pinned public compiler must still be verified'));
});

test('closures and functors preview illustrates captured state and explicit callable objects safely', async () => {
  const [source, html, app] = await Promise.all([
    read('examples/preview/closures-functors.atto'),
    read('index.html'),
    read('src/app.js')
  ]);
  header('closures-functors', source);
  assert.doesNotMatch(source, /not browser-lowered/i);
  assert.match(source, /val triple = \|value\| : int -> value \* captured_factor;/);
  assert.match(source, /return triple\(14\)/);
  assert.match(source, /return multiply\(3\) \+ plus_seven\.call\(35\)/);
  assert.match(source, /Fnc<int,int> still requires separate callable lowering/);
  assert.doesNotMatch(source, /fnc make_multiplier\(/);
  assert.match(source, /pub call\(int value\): int/);
  assert.match(source, /self\.offset/);
  assert.match(source, /plus_seven\.call\(35\)/);
  assert.doesNotMatch(source, /plus_seven\(35\)/, 'no implicit callable-object syntax without a language contract');
  assert.match(source, /fnc main\(\): int/);
  assert.match(html, /<option value="preview\/closures-functors">Closures and functors<\/option>/);
  assert.match(app, /"preview\/closures-functors"/);
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
  assert.match(html, /<option value="preview\/trap">trap keyword — catch throws \/ Option \/ Result<\/option>/);
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
  assert.match(source, /Option<Result<int, String>> thrown = trap checked_or_throw\(13\)/);
  assert.match(source, /throw Error\("unexpected id"\)/);
  assert.match(source, /print_trapped\(thrown\)/);
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


test('generator preview requires explicit *gen and runs in the browser', async () => {
  const html = await read('index.html');
  const source = await read('examples/preview/generators.atto');
  assert.match(html, /<option value="preview\/generators">Generators \(\*gen \/ yield \/ yield\*\)<\/option>/);
  header('generators', source);
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
  header('result-option-end', ended);
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
  header('match-values', source);
  assert.match(html, /<option value="preview\/match-values">Match: values and guards<\/option>/);
  assert.equal((source.match(/^\s*return match value over$/gm) || []).length, 2,
    'both match functions must explicitly return their match value');
  assert.match(source, /fnc classify\(int value\): int \{\s*return match value over/);
  for (const arm of [
    'on 0 -> { return 0; }',
    'on 1 -> { return 1; }',
    'on n when n > 1 -> { return 2; }',
    'on _ -> { return -1; }',
  ]) {
    assert.ok(source.includes(arm), 'block-return arm missing: ' + arm);
  }
  assert.match(source, /fnc xyx\(int value\): int \{\s*return match value over/);
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
  assert.doesNotMatch(source, /expression-arm form.*not runnable/);
});

test('boolean preview includes six variadic and array gate examples safely', async () => {
  const preview = await read('examples/preview/boolean-operators.atto');
  header('boolean-operators', preview);
  assert.match(preview, /val c = true;/);
  assert.match(preview, /val d = false;/);
  assert.match(preview, /Variadic and array gate forms\./);
  assert.doesNotMatch(preview, /not yet supported by the pinned browser compiler/i);
  const calls = preview.split('\n').map(line => line.trim()).filter(line => line.startsWith('stdio.println('));
  assert.deepEqual(calls, [
    'stdio.println(a && b);',
    'stdio.println(a || b);',
    'stdio.println(Xor(a, b)); // ^^ remains reserved; executable XOR uses the builtin.',
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
  assert.doesNotMatch(preview, /stdio\.println\(a \^\^ b\);/, '^^ is reserved and must not be executable');
});


test('Fibonacci return-match preview runs in the browser', async () => {
  const [source, html, app] = await Promise.all([
    read('examples/preview/fib-match.atto'), read('index.html'), read('src/app.js')
  ]);
  header('fib-match', source);
  assert.match(source, /return match n over/);
  assert.match(source, /on 0 -> 0,/);
  assert.match(source, /on 1 -> 1,/);
  assert.match(source, /on _ -> fib\(n - 1\) \+ fib\(n - 2\),/);
  assert.match(source, /return fib\(12\);/);
  assert.match(html, /<option value="preview\/fib-match">Fibonacci: return match \/ end<\/option>/);
  assert.match(app, /"preview\/fib-match"/);
});

// Additional non-executable language-preview catalog coverage.
const names = ["modules","namespaces","actor-receiver-methods","stdio-channels","traits-interfaces","diamond-inheritance","data-shapes"];

test('preview additions have an enabled compile/execute workflow', async () => {
  const [html, app, release] = await Promise.all([
    read('index.html'), read('src/app.js'), read('../.github/scripts/package-playground.mjs')
  ]);
  assert.match(html, /<optgroup label="Examples">/);
  assert.match(html, /<optgroup label="Language showcase — executable in browser">/);
  assert.match(html, /Language previews — syntax only \(compiler diagnostics\)/);
  assert.match(app, /runButton\.disabled = controlsDisabled/);
  assert.match(app, /formatButton\.disabled = value \|\| PREVIEW_EXAMPLES\.has\(selector\.value\)/);
  for (const name of names) {
    assert.equal(html.split('value="preview/' + name + '"').length - 1, 1);
    assert.equal(registeredCount(app, name), 1);
    assert.equal(release.split("'examples/preview/" + name + ".atto'").length - 1, 1);
    const source = await read('examples/preview/' + name + '.atto');
    header(name, source);
    assert.match(source, /fnc main\(\): int/);
    assert.doesNotMatch(source, /\.ores\b/);
  }
});

test('module imports are explicit and use namespace is a file header, not an open import', async () => {
  const [a,b] = await Promise.all([read('examples/preview/modules.atto'),read('examples/preview/namespaces.atto')]);
  for (const value of ['define module Arithmetic as','define module Internal as','pub fnc double(int value)','Arithmetic.double(21)'])
    assert.ok(a.includes(value), value);
  assert.doesNotMatch(a, /define pub module/);
  assert.match(a, /import \* as Arithmetic from "\.\/arithmetic\.atto"/);
  assert.match(b, /^use namespace storefront;$/m);
  assert.match(b, /^import \* as math from "\.\/math\.atto";$/m);
  assert.match(b, /stdio\.println\(math\.square\(7\)\)/);
  assert.match(b, /does NOT import another module's members/);
  assert.doesNotMatch(b, /^use \+lib\/math;$/m);
  assert.doesNotMatch(b, /^\s*stdio\.println\(square\(/m);
});

test('stdio examples treat input and output as channels with one input consumer', async () => {
  const s = await read('examples/preview/stdio-channels.atto');
  for (const value of ['pub suspends fnc main()', 'stdio.in', 'stdio.out', 'stdio.err', 'writech output,','readch input', 'writech output, item','stdio.in.stream()'])
    assert.ok(s.includes(value), value);
  assert.match(s, /not readch and stream\(\) concurrently/);
  assert.match(s, /byte\/text encoding is target-specific/);
});

test('exact diamond source remains the cross-backend SHA-pinned playground fixture', async () => {
  const source = await readFile(new URL('examples/preview/diamond-inheritance.atto', root));
  const blob = createHash('sha1')
    .update('blob ' + source.length + '\0')
    .update(source)
    .digest('hex');
  // Header-only revision (comments) once the public compiler began executing it;
  // the declarations/expressions audited by atto-source.rs are unchanged.
  assert.equal(blob, '6e9aa419f7a713ae576527961773f5bc3af0fd8a',
    'changes to the verified diamond sample need a new cross-backend compiler audit');
});

test('diamond inheritance preview requires explicit resolution of ambiguous lookups', async () => {
  const source = await read('examples/preview/diamond-inheritance.atto');
  const html = await read('index.html');
  assert.match(html, /<option value="preview\/diamond-inheritance">Traits, multiple inheritance &amp; diamond overrides<\/option>/);
  header('diamond-inheritance', source);
  assert.doesNotMatch(source, /NOT executable in the pinned browser Wasm compiler/);
  assert.match(source, /define pub interface Named as/);
  assert.match(source, /define pub trait Greeter as/);
  assert.match(source, /define class Left extends Root as/);
  assert.match(source, /define class Right extends Root as/);
  assert.match(source, /\/\/ define class Broken extends Left, Right as/);
  assert.match(source, /E_AMBIGUOUS_MEMBER/);
  assert.match(source, /define class Diamond extends Left, Right implements Named, Greeter as/);
  assert.equal((source.match(/pub override describe\(\): string/g) || []).length, 3,
    'each overriding branch and the diamond must explicitly override');
  assert.match(source, /Root\.origin/);
  assert.match(source, /No implicit left-to-right or C3 winner/);
  assert.match(source, /example\.origin\(\)/);
  assert.match(source, /example\.describe\(\)/);
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

test('declared actors use typed mtd receivers, distinct namespaces and sealed state', async () => {
  const [source, html, app, release] = await Promise.all([
    read('examples/preview/actor-receiver-methods.atto'),
    read('index.html'), read('src/app.js'),
    read('../.github/scripts/package-playground.mjs')
  ]);
  assert.match(html, /<option value="preview\/actor-receiver-methods">declare actor — mtd receiver methods<\/option>/);
  assert.equal(app.split('"preview/actor-receiver-methods"').length - 1, 1);
  assert.equal(release.split("'examples/preview/actor-receiver-methods.atto'").length - 1, 1);
  assert.match(source, /^\/\/ SYNTAX PREVIEW/);
  assert.match(source, /^use namespace actor_receiver_demo;$/m);
  assert.equal((source.match(/^declare actor Foo[12];$/gm) || []).length, 2);
  for (const actor of ['Foo1', 'Foo2']) {
    assert.match(source, new RegExp('^declare actor ' + actor + ';$', 'm'));
    assert.doesNotMatch(source, new RegExp('^define actor ' + actor + '(?: as|;)', 'm'));
  }
  assert.match(source, /^mtd \(mut self: Foo1\) increment\(int amount\): void \{$/m);
  assert.match(source, /^mtd \(self: Foo1\) read_count\(\): int \{$/m);
  assert.match(source, /^mtd \(mut self: Foo2\) remember\(int value\): void \{$/m);
  assert.match(source, /^mtd \(self: Foo2\) read_last\(\): int \{$/m);
  assert.equal((source.match(/self\.handle_state\(critical-write \|s\| ->/g) || []).length, 2);
  assert.equal((source.match(/self\.handle_state\(critical-read \|s\| ->/g) || []).length, 2);
  assert.doesNotMatch(source, /^\s*(?:return\s+)?handle_state\(/m, 'state access must be receiver-qualified');
  assert.doesNotMatch(source, /^mtd \((?:Foo[12](?: self| _)?|mut Foo[12])\)/m, 'obsolete receiver order');
  assert.doesNotMatch(source, /self\.(?:count|last_value)|(?:first|second)\.(?:count|last_value)/);
  assert.match(source, /val first = spawn Foo1\(\);/);
  assert.match(source, /val second = spawn Foo2\(\);/);
  assert.match(source, /first\.send\(1\);/);
  assert.match(source, /second\.send\(42\);/);
  assert.doesNotMatch(source, /^\s*(?:first|second)\.(?:increment|remember|read_count|read_last)\(/m,
    'ActorRefs are not ordinary synchronous method receivers');
  assert.match(source, /full definitions with compatible receive handlers are absent/);
  assert.match(source, /not browser-lowered/);
  const contract = await read('docs/COMPILER_CONTRACT.md');
  assert.match(contract, /Six additional \*\*non-executable\*\* language previews/);
  assert.match(contract, /Declared actors and receiver methods:/);
  assert.match(contract, /proposed \/ unverified/);
  assert.match(contract, /Actor state is sealed behind/);
  assert.match(contract, /mailbox `send\(\)` \(admission, not execution completion\)/);
});


// Hard gate: UI, runtime, publication allowlist and source inventory must agree.
test('preview inventory is exact, and preview-only source remains fail-closed', async () => {
  const [html, app, release] = await Promise.all([
    read('index.html'), read('src/app.js'), read('../.github/scripts/package-playground.mjs')
  ]);
  const menu = [...html.matchAll(/<option value="preview\/([a-z-]+)"/g)].map(m => m[1]);
  const registered = app.match(/const PREVIEW_EXAMPLES = new Set\((\[[^\n]+\])\)/);
  assert.ok(registered);
  const runtime = JSON.parse(registered[1]).map(p => p.slice('preview/'.length));
  const packaged = [...release.matchAll(/'examples\/preview\/([a-z-]+)\.atto'/g)].map(m => m[1]);
  const { readdir } = await import('node:fs/promises');
  const onDisk = (await readdir(new URL('examples/preview/', root)))
    .filter(n => n.endsWith('.atto')).map(n => n.slice(0, -'.atto'.length));
  // The dropdown groups previews by tier (runs / syntax only), so compare it as a set.
  assert.deepEqual([...menu].sort(), [...previews].sort(), 'menu must match the complete catalog');
  for (const [name, values] of Object.entries({runtime, packaged}))
    assert.deepEqual(values, previews, name + ' must match the complete catalog');
  assert.deepEqual(onDisk.sort(), [...previews].sort(), 'every .atto file must appear in the catalog');
  assert.equal(new Set(previews).size, previews.length, 'duplicate preview keys');
  assert.match(app, /compileButton\.addEventListener\('click'/);
  assert.match(app, /runButton\.addEventListener\('click'/);
  assert.doesNotMatch(app, /runButton\.disabled = controlsDisabled \|\| preview/);
  assert.match(app, /runButton\.disabled = controlsDisabled/);
  assert.match(app, /formatButton\.disabled = value \|\| PREVIEW_EXAMPLES\.has\(selector\.value\)/);
  assert.match(app, /onSelectionStart: invalidateArtifact/);
});

test('expanded previews retain explicit limitations and source-contract examples', async () => {
  const snippets = {
  "effects": [
    "pure fnc",
    "using io, suspend",
    "throws(Error)",
    "raises(Error)",
    "panics(Error)"
  ],
  "suspends": [
    "suspends fnc",
    "await load_answer()",
    "suspends |int n|"
  ],
  "nio-reactor": [
    "NioReactor",
    "reactor.accept",
    "reactor.read",
    "reactor.write"
  ],
  "mutex-locks": [
    "Mutex<int>",
    "counter.lock_async()",
    "Acquisition must suspend"
  ],
  "mutable-state": [
    "state {",
    "handle_state(critical-write |s|",
    "handle_state(critical-read |s|",
    "on_start()"
  ],
  "guard": [
    "guard value > 0 {",
    "return Err("
  ],
  "lambdas-advanced": [
    "|n| : int -> n + offset",
    "|n| : int -> n * 2",
    "|n| : bool -> return n > 0;",
    "fnc(int) => int",
    "pub call(int value): int"
  ],
  "routine": [
    "routine square",
    "apply(twice, 21)",
    "direct-call-only",
    "currently allows recursion"
  ],
  "visibility-modifiers": [
    "export pub Foo;",
    "export pub[pkg] class Bar;",
    "external fnc",
    "internal fnc",
    "protected final"
  ]
};
  for (const [name, expected] of Object.entries(snippets)) {
    const source = await read('examples/preview/' + name + '.atto');
    header(name, source);
    if (!EXEC.has(name)) assert.match(source, /not browser-lowered|NOT a shipped guest API|NOT an implementation guaranteed|not be advertised/i);
    assert.match(source, /fnc main\(\)/, name);
    assert.doesNotMatch(source, /<script\b|^#include\b/m);
    if (name === 'guard') {
      assert.match(source, /A guard has NO else/);
      assert.match(source, /failure branch falls through/);
      assert.doesNotMatch(source, /^\s*guard[^\n]*else\s*\{/m);
    }
    for (const part of expected) assert.ok(source.includes(part), name + ' missing ' + part);
  }
});

test('bounded direct lambdas execute while advanced callable designs remain syntax-only', async () => {
  const [runnable, source, html, app, profile] = await Promise.all([
    read('examples/preview/lambdas.atto'), read('examples/preview/lambdas-advanced.atto'),
    read('index.html'), read('src/app.js'), read('example-backend-profile.json').then(JSON.parse)
  ]);
  assert.match(html, /<option value="preview\/lambdas">Direct lambdas and immutable captures<\/option>/);
  assert.match(html, /<option value="preview\/lambdas-advanced">Advanced lambdas and higher-order functions \(syntax only\)<\/option>/);
  assert.match(app, /"preview\/lambdas"/);
  assert.match(app, /"preview\/lambdas-advanced"/);
  assert.equal(profile.preview.find(x => x.name === 'lambdas').expect, 'exec');
  assert.equal(profile.preview.find(x => x.name === 'lambdas-advanced').expect, 'preview-only');
  assert.match(runnable, /^\/\/ LANGUAGE PREVIEW — compiles and runs in this browser playground\./);
  assert.match(runnable, /val multiply = \|n\| : int -> n \* factor;/);
  assert.match(runnable, /val answer = \|\| -> 42;/);
  assert.match(runnable, /val add_offset = \|n\| : int -> n \+ offset;/);
  assert.match(runnable, /first \+ second \+ third;/);
  assert.doesNotMatch(runnable, /fnc\(int\) => int|make_adder|wildcard_lambda_demo/);
  assert.match(source, /^\/\/ SYNTAX PREVIEW.*not browser-lowered/);
  assert.match(source, /Lambda: an anonymous function/);
  assert.match(source, /Closure: a lambda retaining its lexical environment/);
  assert.match(source, /Functor: a class instance with a named call method/);
  assert.match(source, /fnc make_adder\(int offset\): fnc\(int\) => int/);
  assert.match(source, /return \|n\| : int -> n \+ offset;/);
  assert.match(source, /val double_it = \|n\| : int -> n \* 2;/);
  assert.match(source, /val is_positive = \|n\| : bool -> return n > 0;/);
  assert.match(source, /define class Multiplier as/);
  assert.match(source, /pub call\(int value\): int/);
  assert.match(source, /triple\.call\(14\)/);
  assert.doesNotMatch(source, /triple\(14\)/, 'do not invent implicit functor invocation');
  assert.match(source, /borrowed values or sealed actor-state loans escape/);
  assert.match(source, /execution and cross-backend parity are unverified/);
  assert.doesNotMatch(source, /\|[^|\n]*\|\s*=>/,
    'lambda body delimiter must be ->, not legacy =>');
  assert.doesNotMatch(source, /fnc\([^)]*\)\s*->/,
    'callable type declarations must use =>, not ->');
});

test('sealed state, lock leases and ordered exports respect preview safety', async () => {
  const [state, mutex, exports] = await Promise.all([
    read('examples/preview/mutable-state.atto'),
    read('examples/preview/mutex-locks.atto'),
    read('examples/preview/visibility-modifiers.atto')
  ]);
  assert.match(state, /self\.handle_state\(critical-write \|s\| -> \{/);
  assert.match(state, /self\.handle_state\(critical-read \|s\| -> s\.count\)/);
  assert.doesNotMatch(state, /^\s*self\.count(?:\s*[=+.]|\s*;)/m);
  assert.doesNotMatch(state, /await [^\n]*critical-write|critical-write[^\n]*await /);
  assert.match(mutex, /using counter\.lock_async\(\) as lock_lease/);
  assert.doesNotMatch(mutex, /\bas guard\b/, 'guard keyword cannot be an identifier');
  assert.match(mutex, /NEVER be held across await\/select/);
  assert.ok(exports.indexOf('export pub Foo;') < exports.indexOf('define class Foo as'),
    'export pub Foo must work before its declaration');
  assert.ok(exports.indexOf('export pub[pkg] class Bar;') > exports.indexOf('define class Bar as'),
    'explicit kind export must also work after its declaration');
  assert.doesNotMatch(exports, /^export\[pkg\]/m, 'old export syntax is not the selected spelling');
});

test('standalone define state container preview runs with Worker-local critical leases', async () => {
  const [source, html, app, release] = await Promise.all([
    read('examples/preview/state-containers.atto'),
    read('index.html'), read('src/app.js'),
    read('../.github/scripts/package-playground.mjs')
  ]);
  header('state-containers', source);
  assert.match(source, /^define state container Counter as$/m);
  assert.match(source, /^  state \{$/m);
  assert.match(source, /let int count: 0;/);
  assert.match(source, /new Counter\(\)/);
  assert.match(source, /pub increment\(int amount\)/);
  assert.match(source, /handle_state\(critical \|s\| -> \{/);
  assert.match(source, /handle_state\(critical-write \|s\| -> \{/);
  assert.match(source, /handle_state\(critical-read \|s\| -> s\.count\)/);
  assert.match(source, /fnc main\(\): int/);
  assert.match(source, /implements a Worker-local profile/);
  assert.match(source, /must not leak s or a field reference, await\/select/);
  assert.doesNotMatch(source, /^\s*(?:counter|self)\.count\b/m, 'state may not be accessed directly');
  assert.equal(html.split('value="preview/state-containers"').length - 1, 1);
  assert.equal(registeredCount(app, 'state-containers'), 1);
  assert.equal(release.split("'examples/preview/state-containers.atto'").length - 1, 1);
});

test('lexical scope and pure sample contrasts lexical capture with block shadowing', async () => {
  const [source, html, app] = await Promise.all([
    read('examples/preview/lexical-scope-pure.atto'),
    read('index.html'),
    read('src/app.js')
  ]);
  assert.ok(html.includes('<option value="preview/lexical-scope-pure">Lexical scope and pure keyword</option>'));
  header('lexical-scope-pure', source);
  assert.ok(source.includes('pure fnc twice(int value): int'));
  assert.ok(source.includes('pure fnc plus_two(int value): int'));
  assert.ok(source.includes('val factor = 2;'));
  assert.ok(source.includes('val scale = |value| : int -> value * factor;'));
  assert.match(source, /block \{[\s\S]*val factor = 100;/);
  assert.ok(source.includes('stdio.println(scale(21)); // 42, not 2100'));
  assert.ok(source.includes('stdio.println(plus_two(twice(20))); // 42'));
  assert.ok(source.includes('only_here is out of scope'));
  const pureBodies = [...source.matchAll(/pure fnc \w+\([^)]*\): int \{([^}]*)\}/g)];
  assert.equal(pureBodies.length, 2);
  for (const [, body] of pureBodies) assert.doesNotMatch(body, /stdio|writech|readch|await|spawn|handle_state/);
  assert.ok(source.includes('pure fnc bad_output(): void { stdio.println(42); }'));
  assert.match(app, /runButton\.disabled = controlsDisabled/);
});

test('explicit ownership preview runs bounded loans in the browser', async () => {
  const [source, html, app, release] = await Promise.all([
    read('examples/preview/borrow-checking.atto'),
    read('index.html'),
    read('src/app.js'),
    read('../.github/scripts/package-playground.mjs'),
  ]);
  header('borrow-checking', source);
  assert.doesNotMatch(source, /NOT browser-lowered/);
  assert.match(source, /fnc main\(\): int/);
  for (const spelling of [
    'borrow! parcel', 'borrow! mut parcel', 'copy! source_number',
    'take! parcel', 'share! 42',
  ]) {
    assert.ok(source.includes(spelling), 'missing canonical prefix ownership syntax: ' + spelling);
  }
  assert.match(source, /borrow! mut parcel/, 'exclusive borrow uses a separate mut qualifier');
  assert.doesNotMatch(source, /borrow! mut\(/, 'the example must not require parentheses');
  assert.doesNotMatch(source, /borrow_mut!/, 'borrow_mut! is not valid AttoLang syntax');
  assert.match(source, /two immutable loans/);
  assert.match(source, /exclusive mutable loan/);
  assert.match(source, /owner is moved/);
  assert.match(source, /copyable types only/);
  assert.match(source, /shareability and thread-safety checks/);
  assert.match(source, /INVALID EXAMPLES.*commented out/);
  assert.match(source, /use after take/);
  assert.match(source, /conflicting loans/);
  assert.match(source, /borrow cannot escape/);
  assert.ok(html.includes('<option value="preview/borrow-checking">Borrow checking: borrow! / copy! / take! / share!</option>'));
  assert.equal(registeredCount(app, 'borrow-checking'), 1);
  assert.equal(release.split("'examples/preview/borrow-checking.atto'").length - 1, 1);
  assert.match(app, /runButton\.disabled = controlsDisabled/);
  assert.match(app, /formatButton\.disabled = controlsDisabled \|\| preview/);
  assert.match(app, /checkFormatButton\.disabled = value \|\| PREVIEW_EXAMPLES\.has\(selector\.value\)/);
});

test('ownership and concurrency containers are taught without claiming compiler support', async () => {
  const source = await read('examples/preview/borrow-arc-send-atomic-box.atto');
  const html = await read('index.html');
  const app = await read('src/app.js');
  assert.match(html, /<option value="preview\/borrow-arc-send-atomic-box">Ownership containers: Arc \/ Send \/ Atomic \/ Box<\/option>/);
  assert.match(app, /"preview\/borrow-arc-send-atomic-box"/);
  assert.match(source, /^\/\/ SYNTAX PREVIEW/);
  assert.match(source, /not browser-lowered/);
  assert.match(source, /fnc hand_off<T: Send>\(T item\): T/);
  assert.match(source, /fnc main\(\): int/);
  for (const token of ['borrow! initial', 'copy! initial', 'take! initial', 'borrow! unique',
      'take! unique', 'share! shared_handle', 'share! counter', 'Box<int>', 'Arc<int>',
      'Arc<Atomic<int>>', 'Atomic<int>', 'fetch_add(1)']) {
    assert.ok(source.includes(token), 'missing ownership demonstration: ' + token);
  }
  assert.match(source, /use after take!/);
  assert.match(source, /active loan prevents move/);
  assert.match(source, /borrow! mut unique/);
  assert.doesNotMatch(source, /borrow_mut!/);
  assert.match(source, /Box<int> is not implicitly Copy/);
  assert.match(source, /Arc does not grant unsynchronized mutation/);
  assert.match(source, /Send is a transfer-safety type bound/);
  assert.match(source, /order\/ABI still unspecified/);
  assert.match(source, /intended result: 80, not browser-executed/);
  // Rejection examples must be comments, never accidentally executable guest code.
  assert.equal(source.split('\n').filter(line => line.includes('INVALID:')).length, 4);
});

test('static package imports use one import keyword while scoped using remains distinct', async () => {
  const source = await read('examples/preview/use-using-with.atto');
  const html = await read('index.html');
  assert.match(source, /^import span from pkg "core\.telemetry";$/m);
  assert.match(source, /^import sleep from pkg "std\.time";$/m);
  assert.doesNotMatch(source, /^use (?:core|std)\./m);
  assert.match(source, /using span\("playground\.demo"\) as active_span/);
  assert.match(source, /with timeout\(2000\)/);
  assert.match(source, /^\/\/ PREVIEW ONLY:/);
  assert.match(html, /<option value="preview\/use-using-with">import \/ using \/ with<\/option>/);
});
