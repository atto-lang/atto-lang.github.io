// Candidate-only execution receipt: NEVER use this file to repin or publish
// compiler bytes. The public compiler remains the separately approved artifact.
// To enable, provide an isolated candidate site checkout with a separately
// verified receipt/source tree and set ATTO_VERIFY_PRIVATE_PREVIEWS=1.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createCompiler } from '../src/compiler.js';
import { guestImports, describePanic } from '../src/guest.js';

const candidate = process.env.ATTO_VERIFY_PRIVATE_PREVIEWS === '1';

test('private candidate executes six preview guests with exact outputs; invalid source fails closed', {
  skip: !candidate && 'Not approved for public compiler pin; run only in isolated private candidate CI'
}, async t => {
  const requiredSource = process.env.ATTO_PRIVATE_COMPILER_HEAD;
  assert.match(requiredSource || '', /^[a-f0-9]{40}$/,
    'the private candidate source head must be explicitly supplied by the verifier');
  const receipt = JSON.parse(await readFile(new URL('../public/atto_compiler.receipt.json', import.meta.url), 'utf8'));
  const bytes = await readFile(new URL('../public/atto_compiler.wasm', import.meta.url));
  const digest = createHash('sha256').update(bytes).digest('hex');
  assert.equal(receipt.source_head, requiredSource);
  assert.equal(receipt.compiler_sha256, digest);
  assert.equal(receipt.compiler_bytes, bytes.length);
  assert.equal(receipt.compiler_abi, 2);
  assert.equal(receipt.guest_abi, 'atto.browser.guest.v2');
  assert.ok(WebAssembly.validate(bytes), 'candidate is real browser compiler WebAssembly');
  const compiler = await createCompiler(bytes);

  const golden = [
    { name: 'generators', value: 10n, stdout: '10\n' },
    { name: 'closures-functors', value: 84n, stdout: '' },
    { name: 'borrow-checking', value: 63n, stdout: '84\n43\n' },
    { name: 'fib-match', value: 144n, stdout: '0 1 1 2 3 5 8 13 21 34 \n' },
    { name: 'function-pipeline', value: 121n, stdout: '121\n' },
    { name: 'trap', value: 7n, stdout: '5\nid must be nonnegative\nan ordinary throw was caught\n' }
  ];
  for (const fixture of golden) {
    await t.test(fixture.name + ' compiles a genuine guest and executes its checked result', async () => {
      const source = await readFile(new URL('../examples/preview/' + fixture.name + '.atto', import.meta.url), 'utf8');
      const result = compiler.compile(source);
      assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
      assert.ok(WebAssembly.validate(result.wasm));
      const module = await WebAssembly.compile(result.wasm);
      const out = { text: '', truncated: false };
      const { imports, bind } = guestImports(module, out);
      const instance = await WebAssembly.instantiate(module, imports);
      bind(instance);
      let value;
      try { value = instance.exports.main(); }
      catch (error) { assert.fail('Unexpected guest panic: ' + describePanic(instance, error)); }
      assert.equal(value, fixture.value);
      assert.equal(out.text, fixture.stdout);
      assert.equal(out.truncated, false);
    });
  }

  await t.test('invalid immutable assignment emits no guest, and the compiler recovers', () => {
    const rejected = compiler.compile('pub fnc main(): int { val x = 5; x = 6; return x; }');
    assert.equal(rejected.ok, false);
    assert.match(rejected.diagnostics[0]?.message ?? '', /^E_IMMUTABLE:/);
    assert.equal(Object.hasOwn(rejected, 'wasm'), false);
    const valid = compiler.compile('pub fnc main(): int { return 42; }');
    assert.equal(valid.ok, true);
    assert.ok(WebAssembly.validate(valid.wasm));
  });
  // A green result here is candidate evidence, NOT authorization to relabel
  // previews as released, alter pin/digests, or bypass independent review.
});
