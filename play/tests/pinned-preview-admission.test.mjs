// Exhaustive admission and execution gate for the *published*, SHA-pinned Rust-built Wasm
// compiler. Preview picker controls must never be mistaken for guest execution.
// This is not a test of an unpublished Rust branch, and it does not certify
// Oreslang Java/LLVM parity or a candidate browser release.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { createCompiler } from '../src/compiler.js';
import { guestImports, usesStateLeases } from '../src/guest.js';
import { createStateRuntime } from '../src/state-runtime.js';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');
const profile = JSON.parse(await read('example-backend-profile.json'));
const recovery = 'pub fnc main(): int { return 42; }';

test('every published language preview reaches the pinned compiler and never fabricates a guest', async t => {
  const [receipt, binary, html, app, release, names] = await Promise.all([
    read('public/atto_compiler.receipt.json').then(JSON.parse),
    readFile(new URL('public/atto_compiler.wasm', root)),
    read('index.html'),
    read('src/app.js'),
    read('../.github/scripts/package-playground.mjs'),
    readdir(new URL('examples/preview/', root))
  ]);
  assert.equal(receipt.source_repository, 'atto-lang/atto-source.rs');
  assert.match(receipt.source_head, /^[a-f0-9]{40}$/);
  assert.equal(binary.length, receipt.compiler_bytes);
  assert.equal(createHash('sha256').update(binary).digest('hex'), receipt.compiler_sha256);
  const previewNames = names.filter(name => name.endsWith('.atto'))
    .map(name => name.slice(0, -5)).sort();
  const menu = [...html.matchAll(/<option value="preview\/([a-z0-9-]+)"/g)]
    .map(match => match[1]).sort();
  const declared = app.match(/const PREVIEW_EXAMPLES = new Set\((\[[^\n]+\])\)/);
  assert.ok(declared, 'missing explicit preview guard');
  const guarded = JSON.parse(declared[1]).map(name => name.replace(/^preview\//, '')).sort();
  assert.deepEqual(menu, previewNames, 'each preview file must be shown in picker');
  assert.deepEqual(guarded, previewNames, 'every published preview is registered');
  assert.match(html, /id="compile"/);
  assert.match(html, /id="run"/);
  assert.match(app, /compileButton\.disabled = controlsDisabled/);
  assert.match(app, /runButton\.disabled = controlsDisabled/);
  assert.doesNotMatch(app, /runButton\.disabled = controlsDisabled \|\| preview/);
  assert.equal(previewNames.length > 0, true, 'empty preview catalog is not verification');
  const compiler = await createCompiler(binary);
  // Exactly the previews with an exec oracle may emit a guest; each must then
  // print the exact stdout and return the exact value. Every other preview
  // must still be rejected with a positioned diagnostic and no artifact.
  const oracle = new Map(profile.preview.filter(x => x.expect === 'exec').map(x => [x.name, x]));
  assert.equal(oracle.size, 29, 'executable preview count changed: update the oracle deliberately');
  for (const name of previewNames) {
    await t.test(name, async () => {
      const path = 'examples/preview/' + name + '.atto';
      const source = await read(path);
      assert.ok(release.includes("'"+path+"'"), 'not in protected release allowlist');
      const result = compiler.compile(source);
      const expected = oracle.get(name);
      if (expected) {
        assert.equal(result.ok, true, name + ': ' + JSON.stringify(result.diagnostics));
        assert.ok(WebAssembly.validate(result.wasm));
        assert.deepEqual(compiler.compile(source).wasm, result.wasm, name + ': deterministic compile');
        const guestModule = await WebAssembly.compile(result.wasm);
        const output = { text: '', truncated: false };
        const state = usesStateLeases(guestModule) ? createStateRuntime() : null;
        const { imports, bind } = guestImports(guestModule, output, null, null, { state });
        const instance = await WebAssembly.instantiate(guestModule, imports);
        bind(instance);
        assert.equal(String(instance.exports.main()), expected.return, name + ': return value');
        state?.complete();
        assert.equal(output.text, expected.stdout, name + ': stdout');
        assert.equal(output.truncated, false);
        return;
      }
      assert.equal(result.ok, false,
        name + ' unexpectedly emitted a guest with pinned compiler ' + receipt.source_head +
        '; add an exec oracle with exact stdout/return to example-backend-profile.json');
      assert.equal(Object.hasOwn(result, 'wasm'), false,
        name + ' must not expose executable guest bytes on rejection');
      assert.match(result.diagnostics?.[0]?.message ?? '', /^E_[A-Z0-9_]+:/,
        name + ' must return a structured language diagnostic');
      assert.ok(result.diagnostics[0].line >= 1 && result.diagnostics[0].column >= 1,
        name + ' must return an actionable source position');
      // Compiler rejection must not poison the next guest or retain prior output.
      const valid = compiler.compile(recovery);
      assert.equal(valid.ok, true, name + ' prevented a subsequent valid compilation');
      assert.ok(valid.wasm instanceof Uint8Array && WebAssembly.validate(valid.wasm));
    });
  }
});

test('all language-code fences in public whitepapers are classified and the runnable one executes', async () => {
  const docs = (await readdir(new URL('../whitepapers/', root)))
    .filter(name => name.endsWith('.md')).sort();
  const snippets = [];
  for (const name of docs) {
    const markdown = await read('../whitepapers/' + name);
    for (const match of markdown.matchAll(/^```atto(?:[ \t]+[^\n]*)?\n([\s\S]*?)^```[ \t]*$/gm)) {
      snippets.push({ path: name, source: match[1].trim() });
    }
  }
  // Newly added whitepaper source must receive an explicit executable or
  // preview-only admission contract instead of silently becoming a claim.
  assert.deepEqual(snippets.map(x => x.path), ['01-language-design.md']);
  assert.deepEqual(snippets[0].source, [
    'pub fnc main(): int {',
    '  val answer = 6 * 7;',
    '  stdio.println(answer);',
    '  return answer;',
    '}'
  ].join('\n'));
  const compiler = await createCompiler(await readFile(new URL('public/atto_compiler.wasm', root)));
  const result = compiler.compile(snippets[0].source);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.ok(WebAssembly.validate(result.wasm));
  const guestModule = await WebAssembly.compile(result.wasm);
  const output = { text: '', truncated: false };
  const { imports, bind } = guestImports(guestModule, output);
  const instance = await WebAssembly.instantiate(guestModule, imports);
  bind(instance);
  assert.equal(instance.exports.main(), 42n);
  assert.equal(output.text, '42\n');
  assert.equal(output.truncated, false);
});

test('homepage AttoLang source card is real compiled guest Wasm, not decorative code', async () => {
  const html = await read('../index.html');
  const blocks = [...html.matchAll(/<pre><code>([\s\S]*?)<\/code><\/pre>/g)];
  assert.equal(blocks.length, 1, 'new homepage code card requires an explicit executable contract');
  const source = blocks[0][1].trim();
  assert.equal(source, [
    'pub fnc main(): int {',
    '  val x: int = 6;',
    '  return x * 7;',
    '}'
  ].join('\n'));
  const compiler = await createCompiler(await readFile(new URL('public/atto_compiler.wasm', root)));
  const result = compiler.compile(source);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.ok(WebAssembly.validate(result.wasm));
  const guestModule = await WebAssembly.compile(result.wasm);
  const output = { text: '', truncated: false };
  const { imports, bind } = guestImports(guestModule, output);
  const instance = await WebAssembly.instantiate(guestModule, imports);
  bind(instance);
  assert.equal(instance.exports.main(), 42n);
  assert.equal(output.text, '');
  assert.equal(output.truncated, false);
});

test('opt-z bitwise browser compiler produces guest 188 and fails closed on invalid integers and types', async () => {
  const [source, wasm, receipt] = await Promise.all([
    read('examples/preview/bitwise.atto'),
    readFile(new URL('public/atto_compiler.wasm', root)),
    read('public/atto_compiler.receipt.json').then(JSON.parse)
  ]);
  assert.equal(receipt.source_tree, '12faf599d726020f1e80ef0cafbede25784d0c6c');
  assert.equal(receipt.compiler_sha256, 'd2a02cef9f22ef5482a4ce0346e0ce7f5d9d5be8333db471f909948179254ec5');
  assert.ok(wasm.byteLength <= 1048576, 'pinned public release size limit');
  assert.match(source, /0b101100/);
  assert.match(source, />>>/);
  const compiler = await createCompiler(wasm);
  const guest = compiler.compile(source);
  assert.equal(guest.ok, true, JSON.stringify(guest.diagnostics));
  assert.ok(WebAssembly.validate(guest.wasm));
  const module = await WebAssembly.compile(guest.wasm);
  assert.deepEqual(WebAssembly.Module.imports(module), [], 'bitwise guest must be import-free');
  const instance = await WebAssembly.instantiate(module, {});
  assert.equal(instance.exports.main(), 188n);
  assert.equal(instance.exports.panic_code.value, 0);
  const rejected = [
    ['pub fnc main(): int { return 0b2; }', 'E_INTEGER_LITERAL'],
    ['pub fnc main(): int { return 0b; }', 'E_INTEGER_LITERAL'],
    ['pub fnc main(): int { return 1 ^ true; }', 'E_TYPE'],
    ['pub fnc main(): int { val x: int = 12; x |= 1; return x; }', 'E_IMMUTABLE']
  ];
  for (const [bad, code] of rejected) {
    const value = compiler.compile(bad);
    assert.equal(value.ok, false, 'invalid source was accepted');
    assert.equal(Object.hasOwn(value, 'wasm'), false, 'rejected source emitted guest bytes');
    assert.match(value.diagnostics?.[0]?.message ?? '', new RegExp('^' + code + ':'));
  }
  assert.equal(compiler.compile(source).ok, true, 'error must not poison compiler');
});
