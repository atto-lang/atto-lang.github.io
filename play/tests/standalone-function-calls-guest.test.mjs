// Real pinned Rust/Wasm compiler execution, not a source-text acceptance oracle.
// No remote imports and no JavaScript fallback for the guest result.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createCompiler } from '../src/compiler.js';
import { guestImports, describePanic } from '../src/guest.js';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');
const binary = await readFile(new URL('public/atto_compiler.wasm', root));
const receipt = JSON.parse(await read('public/atto_compiler.receipt.json'));
const compiler = await createCompiler(binary);

async function actual_guest(source) {
  const product = compiler.compile(source);
  if (!product.ok) return { kind: 'compile-error', product };
  assert.equal(WebAssembly.validate(product.wasm), true);
  const module = await WebAssembly.compile(product.wasm);
  const out = { text: '', truncated: false };
  const { imports, bind } = guestImports(module, out);
  const instance = await WebAssembly.instantiate(module, imports);
  bind(instance);
  try {
    return { kind: 'success', value: instance.exports.main(), output: out.text };
  } catch (error) {
    return { kind: 'panic', message: describePanic(instance, error), output: out.text };
  }
}

test('showcase calls a standalone function and pipelines through compiled guest Wasm', async () => {
  assert.equal(createHash('sha256').update(binary).digest('hex'), receipt.compiler_sha256);
  assert.equal(binary.length, receipt.compiler_bytes);
  assert.equal(receipt.source_repository, 'atto-lang/atto-source.rs');
  const source = await read('examples/preview/function-pipeline.atto');
  assert.match(source, /fnc twice\(int x\): int \{ return x \+ x; \}/);
  assert.match(source, /val direct = twice\(21\);/);
  const result = await actual_guest(source);
  assert.equal(result.kind, 'success');
  assert.equal(result.value, 121n);
  assert.equal(result.output, '42\n121\n');
});

test('both scalar formal orders and nested helper calls run as actual browser Wasm guests', async () => {
  const cases = [
    ['type-first', 'fnc twice(int value): int { return value + value; }\n' +
      'pub fnc main(): int { return twice(21); }'],
    ['name-first', 'fnc twice(value: int): int { return value + value; }\n' +
      'pub fnc main(): int { return twice(21); }'],
    ['nested', 'fnc plus_one(int x): int { return x + 1; }\n' +
      'fnc twice(int value): int { return value + value; }\n' +
      'pub fnc main(): int { return twice(plus_one(20)); }'],
  ];
  for (const [name, source] of cases) {
    const result = await actual_guest(source);
    assert.equal(result.kind, 'success', name + ': ' +
      JSON.stringify(result.product?.diagnostics ?? result.message));
    assert.equal(result.value, 42n, name + ': guest result');
    assert.equal(result.output, '', name + ': helper return is not implicit stdout');
  }
});

test('checked i64 errors in separate named functions cannot be optimized away', async () => {
  const guests = [
    `fnc twice(int x): int { return x + x; }
pub fnc main(): int {
  val high: int = 9223372036854775807;
  return twice(high);
}`,
    `fnc first(int a, int b): int { return a; }
pub fnc main(): int {
  val high: int = 9223372036854775807;
  return first(42, high + 1);
}`,
    `fnc first(int x): int {
  val unused: int = x + 1;
  return 42;
}
pub fnc main(): int {
  val high: int = 9223372036854775807;
  return first(high);
}`,
  ];
  for (const source of guests) {
    const result = await actual_guest(source);
    if (result.kind === 'compile-error') {
      assert.equal(Object.hasOwn(result.product, 'wasm'), false,
        'rejection must not include a runnable guest');
      assert.match(result.product.diagnostics?.[0]?.message ?? '',
        /^E_[A-Z0-9_]+:.*(?:overflow|integer)/i,
        'a statically proven arithmetic overflow needs a classified diagnostic');
    } else {
      assert.equal(result.kind, 'panic', 'checked failure was optimized into success');
      assert.equal(result.message, 'E_PANIC: integer overflow');
      assert.equal(result.output, '', 'guest printed a success value before failure');
    }
  }
});

test('unbound and wrongly aritied named calls reject without emitted guest code', () => {
  const sources = [
    'pub fnc main(): int { return missing(42); }',
    'fnc twice(int x): int { return x + x; } pub fnc main(): int { return twice(21, 1); }',
  ];
  for (const source of sources) {
    const result = compiler.compile(source);
    assert.equal(result.ok, false);
    assert.equal(Object.hasOwn(result, 'wasm'), false);
    assert.match(result.diagnostics?.[0]?.message ?? '', /^E_[A-Z0-9_]+:/);
  }
});
