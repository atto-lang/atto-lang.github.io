// Exhaustive admission gate for the *published*, SHA-pinned Rust-built Wasm
// compiler. Preview picker controls must never be mistaken for guest execution.
// This is not a test of an unpublished Rust branch, and it does not certify
// Oreslang Java/LLVM parity or a candidate browser release.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { createCompiler } from '../src/compiler.js';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');
const recovery = 'pub fnc main(): int { return 42; }';

test('every published language preview fails closed against the exact pinned compiler', async t => {
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
  assert.deepEqual(guarded, previewNames, 'each preview must be disabled by runtime guard');
  assert.equal(previewNames.length > 0, true, 'empty preview catalog is not verification');
  const compiler = await createCompiler(binary);
  for (const name of previewNames) {
    await t.test(name, async () => {
      const path = 'examples/preview/' + name + '.atto';
      const source = await read(path);
      assert.ok(release.includes("'"+path+"'"), 'not in protected release allowlist');
      const result = compiler.compile(source);
      assert.equal(result.ok, false,
        name + ' unexpectedly emitted a guest with pinned compiler ' + receipt.source_head +
        '; keep preview disabled and require executable guest/negative tests, exact-tree ' +
        'native+wasm32 parity, reviewed release receipt and approval before promotion');
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
