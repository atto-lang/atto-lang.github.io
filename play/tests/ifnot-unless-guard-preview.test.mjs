// Source/catalog checks only: no compiled Rust/Wasm guest verification.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createCompiler} from '../src/compiler.js';
import {tokenizeAtto} from '../src/syntax-highlight.js';

const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');

test('ifnot/unless/guard preview is registered once and remains diagnostic-only', async () => {
  const [source, html, app, release, catalog, profileText] = await Promise.all([
    read('examples/preview/ifnot-unless-guard.atto'),
    read('index.html'),
    read('src/app.js'),
    read('../.github/scripts/package-playground.mjs'),
    read('tests/example-catalog.test.mjs'),
    read('example-backend-profile.json')
  ]);
  assert.match(source, /^\/\/ SYNTAX PREVIEW — NOT browser-lowered\./);
  for (const fragment of [
    'do ifnot ready then',
    'do unless authorized then',
    'ifnot value >= 0 {',
    'unless value < 100 {',
    'guard value > 0 {',
    'return -50;',
    'ifnot ready then 1 else 2 fi',
    'unless authorized then 3 else 4 fi',
    'INVALID: guard ready',
    'pub fnc main(): int'
  ]) assert.ok(source.includes(fragment), 'Missing source form: ' + fragment);

  const profile = JSON.parse(profileText);
  assert.deepEqual(profile.preview.find(entry => entry.name === 'ifnot-unless-guard'),
    {name:'ifnot-unless-guard', expect:'preview-only'});
  const availableLine = app.split('\n').find(line => line.startsWith('const PREVIEW_EXAMPLES ='));
  const runnableLine = app.split('\n').find(line => line.startsWith('const EXECUTABLE_PREVIEWS ='));
  const available = JSON.parse(availableLine.slice(availableLine.indexOf('['), availableLine.indexOf(']') + 1));
  const executable = JSON.parse(runnableLine.slice(runnableLine.indexOf('['), runnableLine.indexOf(']') + 1));
  assert.equal(available.filter(name => name === 'preview/ifnot-unless-guard').length, 1);
  assert.ok(!executable.includes('preview/ifnot-unless-guard'));
  assert.equal(html.split('value="preview/ifnot-unless-guard"').length - 1, 1);
  const syntaxGroup = html.split('Language previews — syntax only (compiler diagnostics)')[1].split('</optgroup>')[0];
  assert.ok(syntaxGroup.includes('value="preview/ifnot-unless-guard"'));
  assert.equal(release.split("'examples/preview/ifnot-unless-guard.atto'").length - 1, 1);
  assert.ok(catalog.includes('"ifnot-unless-guard"'));

  const tokens = tokenizeAtto(source);
  assert.equal(tokens.map(token => token.text).join(''), source);
  for (const word of ['ifnot','unless','guard'])
    assert.ok(tokens.some(token => token.text === word && token.kind === 'keyword'), word);
});


test('independent negated heads fail closed in the exact SHA-pinned Rust/Wasm compiler', async t => {
  // Do not infer that one rejected gallery program proves all six independent
  // conditional spellings are unsupported. Test each real compiler path.
  const [bytes, receipt] = await Promise.all([
    readFile(new URL('../public/atto_compiler.wasm', import.meta.url)),
    read('public/atto_compiler.receipt.json').then(JSON.parse)
  ]);
  assert.equal(bytes.byteLength, receipt.compiler_bytes);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), receipt.compiler_sha256);
  assert.equal(receipt.source_repository, 'atto-lang/atto-source.rs');
  const compiler = await createCompiler(bytes);
  const recovery = 'pub fnc main(): int { return 42; }';
  const probes = [
    ['do ifnot', 'pub fnc main(): int { do ifnot false then return 7; fi return 42; }'],
    ['do unless', 'pub fnc main(): int { do unless false then return 7; fi return 42; }'],
    ['braced ifnot', 'pub fnc main(): int { ifnot false { return 7; } return 42; }'],
    ['braced unless', 'pub fnc main(): int { unless false { return 7; } return 42; }'],
    ['value ifnot', 'pub fnc main(): int { return ifnot false then 7 else 42 fi; }'],
    ['value unless', 'pub fnc main(): int { return unless false then 7 else 42 fi; }']
  ];
  for (const [name, source] of probes) {
    await t.test(name, () => {
      const result = compiler.compile(source);
      assert.equal(result.ok, false,
        name + ' silently became executable; first validate and approve an updated compiler artifact and example oracle');
      assert.equal(Object.hasOwn(result, 'wasm'), false, name + ' emitted guest bytes on failure');
      assert.match(result.diagnostics?.[0]?.message ?? '', /^E_[A-Z0-9_]+:/,
        name + ' missing compiler-owned diagnostic');
      assert.ok(result.diagnostics?.[0]?.line >= 1 && result.diagnostics?.[0]?.column >= 1,
        name + ' missing source location');
      const recovered = compiler.compile(recovery);
      assert.equal(recovered.ok, true, name + ' corrupted compiler state');
      assert.ok(WebAssembly.validate(recovered.wasm), name + ' invalid recovered guest');
      const guest = new WebAssembly.Module(recovered.wasm);
      assert.deepEqual(WebAssembly.Module.imports(guest), [], 'recovery guest must not import host capabilities');
      assert.equal(new WebAssembly.Instance(guest, {}).exports.main(), 42n);
    });
  }
});

test('else-free guard runs both the success and early-return paths in actual pinned guest Wasm', async t => {
  const [bytes, receipt] = await Promise.all([
    readFile(new URL('../public/atto_compiler.wasm', import.meta.url)),
    read('public/atto_compiler.receipt.json').then(JSON.parse)
  ]);
  assert.equal(bytes.length, receipt.compiler_bytes);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), receipt.compiler_sha256);
  const compiler = await createCompiler(bytes);
  for (const [predicate, expected] of [['true',42n],['false',7n]]) {
    await t.test('guard ' + predicate, () => {
      const src = 'pub fnc main(): int { guard ' + predicate + ' { return 7; } return 42; }';
      const result = compiler.compile(src);
      assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
      assert.ok(WebAssembly.validate(result.wasm));
      const guest = new WebAssembly.Module(result.wasm);
      assert.deepEqual(WebAssembly.Module.imports(guest), [], 'no ambient host capabilities');
      const instance = new WebAssembly.Instance(guest, {});
      assert.equal(instance.exports.main(), expected);
      assert.equal(compiler.compile(src).ok, true, 'repeat guard compile failed');
    });
  }
});
