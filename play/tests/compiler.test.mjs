import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createCompiler, COMPILER_ABI } from '../src/compiler.js';
import { guestImports, describePanic, STDOUT_LIMIT } from '../src/guest.js';

const compilerBytes = await readFile(new URL('../public/atto_compiler.wasm', import.meta.url));
const receipt = JSON.parse(await readFile(new URL('../public/atto_compiler.receipt.json', import.meta.url), 'utf8'));
const compiler = await createCompiler(compilerBytes);

async function execute(wasm) {
  assert.equal(WebAssembly.validate(wasm), true);
  const module = await WebAssembly.compile(wasm);
  const out = { text: '', truncated: false };
  const { imports, bind } = guestImports(module, out);
  const instance = await WebAssembly.instantiate(module, imports);
  bind(instance);
  try {
    return { ok: true, value: instance.exports.main(), stdout: out.text, truncated: out.truncated };
  } catch (error) {
    return { ok: false, message: describePanic(instance, error), stdout: out.text };
  }
}
async function run(source) {
  const r = compiler.compile(source);
  assert.equal(r.ok, true, JSON.stringify(r.diagnostics));
  return execute(r.wasm);
}
const main = body => `pub fnc main(): int {\n${body}\n}`;

test('vendored compiler matches its provenance receipt', () => {
  assert.equal(createHash('sha256').update(compilerBytes).digest('hex'), receipt.compiler_sha256);
  assert.equal(compilerBytes.length, receipt.compiler_bytes);
  assert.equal(receipt.source_repository, 'atto-lang/atto-source.rs');
  assert.match(receipt.source_head, /^[0-9a-f]{40}$/);
  assert.equal(receipt.compiler_abi, COMPILER_ABI);
  assert.equal(receipt.guest_abi, 'atto.browser.guest.v1');
});

test('compiler itself is WebAssembly with no host imports', async () => {
  const mod = await WebAssembly.compile(compilerBytes);
  assert.deepEqual(WebAssembly.Module.imports(mod), []);
});

test('real Atto source to Wasm to execution yields 42', async () => {
  const r = await run('fnc add(int a, int b): int {\n  return a + b;\n}\npub fnc main(): int {\n  val x: int = 40;\n  return add(x, 2);\n}');
  assert.deepEqual([r.ok, r.value], [true, 42n]);
});

test('every bundled example compiles and behaves as documented', async () => {
  const dir = new URL('../examples/', import.meta.url);
  const names = (await readdir(dir)).filter(n => n.endsWith('.atto')).sort();
  assert.deepEqual(names, ['conditions.atto', 'error.atto', 'fib.atto', 'hello.atto', 'overflow.atto', 'primes.atto']);
  const src = n => readFile(new URL(n, dir), 'utf8');
  let r = await run(await src('hello.atto'));
  assert.deepEqual([r.value, r.stdout], [42n, 'Hello from WebAssembly!\n42\n']);
  r = await run(await src('fib.atto'));
  assert.deepEqual([r.value, r.stdout], [144n, '0 1 1 2 3 5 8 13 21 34 \n']);
  r = await run(await src('primes.atto'));
  assert.deepEqual([r.value, r.stdout], [10n, '2\n3\n5\n7\n11\n13\n17\n19\n23\n29\n']);
  r = await run(await src('conditions.atto'));
  assert.deepEqual([r.value, r.stdout], [11n, 'both positive\nat least one even\n']);
  r = await run(await src('overflow.atto'));
  assert.equal(r.ok, false);
  assert.equal(r.message, 'E_PANIC: integer overflow');
  assert.ok(r.stdout.endsWith('4611686018427387904\n'), 'output up to the panic is kept');
  const e = compiler.compile(await src('error.atto'));
  assert.equal(e.ok, false);
  assert.match(e.diagnostics[0].message, /^E_IMMUTABLE/);
  assert.deepEqual([e.diagnostics[0].line, e.diagnostics[0].column], [4, 3]);
});

test('control flow, recursion and overloads', async () => {
  assert.equal((await run(main('  let s = 0;\n  for (let i = 0; i < 5; i++) do\n    s = s + i;\n  done\n  return s;'))).value, 10n);
  assert.equal((await run(main('  let i = 0;\n  while i < 3 do\n    i = i + 1;\n  done\n  return i;'))).value, 3n);
  assert.equal((await run(main('  val x = 5;\n  if x < 3 then\n    return 1;\n  elif x < 6 then\n    return 2;\n  else\n    return 3;\n  fi'))).value, 2n);
  assert.equal((await run('fnc f(int a): int { return a; }\nfnc f(int a, int b): int { return a * b; }\n' + main('  return f(2) + f(3, 4);'))).value, 14n);
  assert.equal((await run('fnc fact(int n): int {\n  if n <= 1 then\n    return 1;\n  fi\n  return n * fact(n - 1);\n}\n' + main('  return fact(20);'))).value, 2432902008176640000n);
});

test('compilation produces source-dependent Wasm artifacts', async () => {
  const first = compiler.compile(main('  return 41;'));
  const second = compiler.compile(main('  return 42;'));
  assert.notDeepEqual(first.wasm, second.wasm);
  assert.equal((await execute(first.wasm)).value, 41n);
  assert.equal((await execute(second.wasm)).value, 42n);
});

test('invalid programs fail closed and never return wasm', () => {
  for (const [source, code] of [
    [main('  val x = 5;\n  x = 6;\n  return x;'), 'E_IMMUTABLE'],
    [main('  return foo;'), 'E_UNBOUND'],
    [main('  return 2 + ;'), 'E_SYNTAX'],
    [main('  val x = 1 return x;'), 'E_SEMICOLON'],
    ['pub fnc main(): int {\n  return 42;', 'E_EOF'],
    [main('  val x = 1;\n  val x = 2;\n  return x;'), 'E_DUPLICATE'],
    [main('  return 42;') + ' malicious', 'E_TOPLEVEL'],
    [main('  return 9223372036854775808;'), 'E_INTEGER_RANGE'],
    [main('  return 7 / 2;'), 'E_UNSUPPORTED'],
    [main('  int x = 7;\n  return x;'), 'E_SYNTAX'],
    [main('  if 1 then\n    return 1;\n  fi\n  return 0;'), 'E_TYPE'],
    [main('  val s = "text";\n  return 0;'), 'E_UNSUPPORTED_TYPE'],
    [main('  return 0;') + '\u0000', 'E_NUL'],
    ['fnc helper(): int { return 1; }', 'E_ENTRY'],
    ['fnc f(int a): int {\n  if a > 1 then\n    return 1;\n  fi\n}\n' + main('  return f(0);'), 'E_RETURN'],
    ['define class P as\nend\n' + main('  return 0;'), 'E_UNSUPPORTED'],
  ]) {
    const r = compiler.compile(source);
    assert.equal(r.ok, false, source);
    assert.match(r.diagnostics[0].message, new RegExp('^' + code + ':'), source);
    assert.equal('wasm' in r, false, source);
  }
});

test('diagnostics carry line and column', () => {
  const r = compiler.compile('pub fnc main(): int {\n  val x = 1;\n  x = 2;\n  return x;\n}');
  assert.deepEqual([r.diagnostics[0].line, r.diagnostics[0].column], [3, 3]);
});

test('source budget and recovery after compiler error', async () => {
  const big = main('  return 0;') + ' '.repeat(70_000);
  const r = compiler.compile(big);
  assert.equal(r.ok, false);
  assert.match(r.diagnostics[0].message, /E_SOURCE_LIMIT/);
  assert.equal((await run(main('  return 42;'))).value, 42n);
});

test('generated programs agree with expected arithmetic', async () => {
  for (let i = 0; i < 100; i++) {
    const a = (i * 1103) % 19001, b = (i * 13) % 1021;
    const r = await run(main(`  let x = ${a};\n  x = x + ${b};\n  return x * 3 - 5;`));
    assert.equal(r.value, BigInt((a + b) * 3 - 5));
  }
});

test('checked arithmetic panics with a language-level message', async () => {
  let r = await run('fnc zero(): int { return 0; }\n' + main('  return 5 % zero();'));
  assert.equal(r.message, 'E_PANIC: division by zero');
  r = await run(main('  val m: int = -9223372036854775808;\n  return m - 1;'));
  assert.equal(r.message, 'E_PANIC: integer overflow');
  r = await run('fnc down(int n): int { return down(n + 1); }\n' + main('  return down(0);'));
  assert.equal(r.ok, false);
  assert.match(r.message, /^E_PANIC: (stack exhausted|integer overflow)/);
});

test('deep nesting fails closed and recovers', async () => {
  const r = compiler.compile(main(`  return ${'('.repeat(300)}1${')'.repeat(300)};`));
  assert.match(r.diagnostics[0].message, /E_NESTING/);
  assert.equal((await run(main(`  return ${'('.repeat(32)}42${')'.repeat(32)};`))).value, 42n);
});

test('guest runtime grants only atto print imports and caps stdout', async () => {
  // hand-built module importing env.fetch must be refused
  const evil = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 2, 13, 1, 3, 101, 110, 118, 5, 102, 101, 116, 99, 104, 0, 0]);
  const module = await WebAssembly.compile(evil);
  assert.throws(() => guestImports(module, { text: '', truncated: false }), /not granted/);
  const r = await run(main('  for (let i = 0; i < 20000; i++) do\n    stdio.println("0123456789");\n  done\n  return 0;'));
  assert.equal(r.truncated, true);
  assert.equal(r.stdout.length, STDOUT_LIMIT);
});
