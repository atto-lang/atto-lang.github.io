// Release gate for the current pinned Rust-to-Wasm browser compiler.
// The playground's full closures/functors/lambdas example must remain a
// non-runnable preview until compiler provenance and guest execution are proven.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createCompiler} from '../src/compiler.js';

test('pinned browser compiler rejects the entire preview without guest bytes', async () => {
  const bytes = await readFile(new URL('../public/atto_compiler.wasm', import.meta.url));
  const receipt = JSON.parse(await readFile(
    new URL('../public/atto_compiler.receipt.json', import.meta.url), 'utf8'));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), receipt.compiler_sha256);
  assert.equal(bytes.length, receipt.compiler_bytes);

  const compiler = await createCompiler(bytes);
  const fullPreview = await readFile(new URL('../examples/preview/lambdas-advanced.atto', import.meta.url), 'utf8');
  assert.match(fullPreview, /fnc make_adder\(int offset\): fnc\(int\) => int/);
  assert.match(fullPreview, /fnc apply_twice\(fnc\(int\) => int operation/);
  const result = compiler.compile(fullPreview);
  assert.equal(result.ok, false,
    'full lexical closures and callable arguments may not silently become executable');
  assert.equal(Object.hasOwn(result, 'wasm'), false, 'rejection must emit no guest artifact');
  assert.match(result.diagnostics?.[0]?.message ?? '', /^E_[A-Z0-9_]+:/,
    'diagnostic must come from pinned Rust compiler, never JS fallback');
  assert.ok(result.diagnostics?.[0]?.line >= 1);
  assert.ok(result.diagnostics?.[0]?.column >= 1);

  const scalar = compiler.compile('pub fnc main(): int { return 42; }');
  assert.equal(scalar.ok, true, 'unsupported callable source must not corrupt the compiler');
  assert.ok(WebAssembly.validate(scalar.wasm));
  const guest = new WebAssembly.Module(scalar.wasm);
  assert.deepEqual(WebAssembly.Module.imports(guest), []);
  assert.equal(new WebAssembly.Instance(guest).exports.main(), 42n);
});
