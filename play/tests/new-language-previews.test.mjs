// Target-syntax/release-wiring checks plus pinned Rust/Wasm negative admission.
// Preview examples are NOT claims of full compiler or cross-backend conformance.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createCompiler} from '../src/compiler.js';

const read = path => readFile(new URL('../'+path, import.meta.url), 'utf8');
const cases = {
  "lambda-delimiters": [
    "// SYNTAX PREVIEW — NOT browser-lowered",
    "// INVALID:",
    "|| : int",
    "|_| : int",
    "|int x|",
    "|x: int",
    "const fnc"
  ],
  "typed-match-select": [
    "// SYNTAX PREVIEW — NOT browser-lowered",
    "// INVALID:",
    "match<int>",
    "select<int>",
    "on Ok(value)",
    "on Err(_)"
  ],
  "package-namespace-imports": [
    "// SYNTAX PREVIEW — NOT browser-lowered",
    "// INVALID:",
    "import pkg 'std.math'",
    "import pkg 'std.time' as clock"
  ],
  "return-first-signatures": [
    "// SYNTAX PREVIEW — NOT browser-lowered",
    "// INVALID:",
    "int• bullet_answer",
    "fnc int <- arrow_answer",
    "raises StorageUnavailableError, throws EmptyAnswerError, AnswerFormatError",
    "throws PermissionDeniedError raises RequestTimeoutError, QuotaExceededError",
    "define class EmptyAnswerError extends Error",
    "define class QuotaExceededError extends Error",
    "plain_bullet_answer",
    "plain_arrow_answer",
    "begin"
  ],
  "operator-spellings": [
    "// SYNTAX PREVIEW — NOT browser-lowered",
    "// INVALID:",
    "12 ^^ 10",
    "1 <<< 3",
    "shifted >>> 2",
    "stdio.out <<",
    "^ bits + down"
  ],
  "actor-pipeline-bang-aliases": [
    "// SYNTAX PREVIEW — NOT browser-lowered",
    "// INVALID:",
    "pipe!",
    "rpipe!",
    "stop!"
  ],
  "data-oriented-layouts": [
    "// SYNTAX PREVIEW — NOT browser-lowered",
    "// INVALID:",
    "layout=aos",
    "layout=soa",
    "layout=aosoa(8)"
  ]
};
test('eight new previews stay syntax-only, uniquely selected and release-allowlisted', async () => {
  const [html,app,profileJson,release,catalog] = await Promise.all([
    read('index.html'),read('src/app.js'),read('example-backend-profile.json'),
    read('../.github/scripts/package-playground.mjs'),read('tests/example-catalog.test.mjs')
  ]);
  const profile=JSON.parse(profileJson);
  const available=JSON.parse(app.match(/const PREVIEW_EXAMPLES = new Set\((\[[^\n]+\])\)/)[1]);
  const runnable=JSON.parse(app.match(/const EXECUTABLE_PREVIEWS = new Set\((\[[^\n]+\])\)/)[1]);
  const group=html.match(/<optgroup label="Language previews — syntax only \(compiler diagnostics\)">([\s\S]*?)<\/optgroup>/);
  assert.ok(group);
  for (const [name,tokens] of Object.entries(cases)) {
    const src=await read('examples/preview/'+name+'.atto');
    const id='preview/'+name;
    assert.equal(html.split('value="'+id+'"').length-1,1,name+' dropdown');
    assert.ok(group[1].includes('value="'+id+'"'),name+' target group');
    assert.equal(available.filter(x=>x===id).length,1,name+' loader');
    assert.equal(runnable.includes(id),false,name+' must not be advertised executable');
    assert.deepEqual(profile.preview.find(x=>x.name===name),{name,expect:'preview-only'});
    assert.equal(release.split("'examples/preview/"+name+".atto'").length-1,1);
    assert.ok(catalog.includes('"'+name+'"'),name+' inventory');
    assert.match(src,/^\/\/ SYNTAX PREVIEW/);
    assert.match(src,/pub fnc main\(\): int/);
    for (const token of tokens) assert.ok(src.includes(token),name+': missing '+token);
  }
});
test('return-first effects use concrete domain errors and exact failure paths', async () => {
  const src = await read('examples/preview/return-first-signatures.atto');
  assert.match(src, /int• bullet_answer\(string raw_answer, bool storage_online\)\nraises StorageUnavailableError, throws EmptyAnswerError, AnswerFormatError\nbegin/);
  assert.match(src, /fnc int <- arrow_answer\(bool permitted, bool timed_out, bool quota_available\)\nthrows PermissionDeniedError raises RequestTimeoutError, QuotaExceededError\nbegin/);
  // The basic styles are still represented without duplicate signatures.
  assert.match(src, /int• plain_bullet_answer\(\)\nbegin/);
  assert.match(src, /fnc int <- plain_arrow_answer\(\)\nbegin/);
  // Error subclasses must not be unused names; each represents a real failure.
  const errors = [
    ['EmptyAnswerError', 'throw', 'raw_answer == ""', 'answer must not be empty'],
    ['AnswerFormatError', 'throw', 'raw_answer != "42"', 'answer must be the decimal text 42'],
    ['StorageUnavailableError', 'raise', '!storage_online', 'answer storage is offline'],
    ['PermissionDeniedError', 'throw', '!permitted', 'caller cannot read the answer'],
    ['RequestTimeoutError', 'raise', 'timed_out', 'answer request exceeded its deadline'],
    ['QuotaExceededError', 'raise', '!quota_available', 'answer service quota exhausted']
  ];
  for (const [name, verb, guard, message] of errors) {
    assert.ok(src.includes('define class ' + name + ' extends Error as end'), name + ': not an Error subclass');
    assert.ok(src.includes('if ' + guard + ' then'), name + ': missing failure condition');
    assert.ok(src.includes(verb + ' new ' + name + '("' + message + '");'), name + ': missing failure transition');
  }
  assert.match(src, /pub fnc main\(\): int \{[\s\S]*return bullet_answer\("42", true\) \+ arrow_answer\(true, false, true\) - 42;/);
  assert.doesNotMatch(src, /define class (?:Bar|Star|Mar|X|Y|Z) extends Error/);
  assert.match(src, /proposed target syntax/);
  assert.match(src, /INVALID: raises int/);
  assert.match(src, /INVALID: throws AnswerFormatError,/);
  const [app, profile] = await Promise.all([
    read('src/app.js'), read('example-backend-profile.json').then(JSON.parse)
  ]);
  assert.ok(app.includes('"preview/return-first-signatures"'));
  assert.equal(profile.preview.find(x => x.name === 'return-first-signatures')?.expect, 'preview-only');
  const executable = JSON.parse(app.match(/const EXECUTABLE_PREVIEWS = new Set\((\[[^\n]+\])\)/)[1]);
  assert.ok(!executable.includes('preview/return-first-signatures'));
});

test('obsolete standalone underscore lambda is rejected in teaching examples',async()=>{
  const src=await read('examples/preview/lambdas-advanced.atto');
  assert.doesNotMatch(src,/^\s*(?:val|const)\s+\w+\s*=\s*_\s*(?::|->)/m);
  assert.match(src,/\|_\| : int -> 5/);
  assert.match(src,/\|_, _\| : int -> 5/);
  assert.match(src,/INVALID: val constant = _ : int -> 5/);
});

// The legacy delimiter-free spellings are forbidden language syntax, not merely
// comments in a preview. Exercise the REAL vendored Rust/Wasm compiler so a
// future binary cannot silently admit them and advertise an executable guest.
test('pinned compiler rejects delimiter-free lambdas and remains usable', async () => {
  const [bytes, receipt] = await Promise.all([
    readFile(new URL('../public/atto_compiler.wasm', import.meta.url)),
    read('public/atto_compiler.receipt.json').then(JSON.parse)
  ]);
  assert.equal(bytes.byteLength, receipt.compiler_bytes);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), receipt.compiler_sha256);
  const compiler = await createCompiler(bytes);
  for (const [label, source] of [
    ['typed discard', 'pub fnc main(): int { const fnc v = _ : int -> 5; return v(9); }'],
    ['untyped discard', 'pub fnc main(): int { const fnc v = _ -> 5; return v(9); }']
  ]) {
    const rejected = compiler.compile(source);
    assert.equal(rejected.ok, false, label + ': delimiter-free lambda accepted');
    assert.equal(Object.hasOwn(rejected, 'wasm'), false, label + ': invalid guest emitted');
    assert.match(rejected.diagnostics?.[0]?.message ?? '', /^E_[A-Z0-9_]+:/,
      label + ': missing compiler-owned diagnostic');
    assert.ok(rejected.diagnostics?.[0]?.line >= 1 && rejected.diagnostics?.[0]?.column >= 1,
      label + ': missing source location');
    const recovered = compiler.compile('pub fnc main(): int { return 42; }');
    assert.equal(recovered.ok, true, label + ': compiler poisoned by rejection');
    assert.ok(WebAssembly.validate(recovered.wasm));
    const mod = new WebAssembly.Module(recovered.wasm);
    assert.deepEqual(WebAssembly.Module.imports(mod), []);
    assert.equal(new WebAssembly.Instance(mod).exports.main(), 42n);
  }
});
