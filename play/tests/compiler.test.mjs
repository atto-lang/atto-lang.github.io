import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createCompiler, verifyCompilerBytes, COMPILER_ABI } from '../src/compiler.js';
import { COMPILER_SHA256, COMPILER_BYTES } from '../src/compiler-pin.js';
import { guestImports, describePanic, appendCapped, actorNames, STDOUT_LIMIT } from '../src/guest.js';

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
  assert.equal(receipt.guest_abi, 'atto.browser.guest.v2');
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
  assert.deepEqual(names, ['actors.atto', 'classes.atto', 'conditions.atto', 'enums.atto', 'error.atto', 'fib.atto', 'hello.atto', 'overflow.atto', 'primes.atto']);
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
  r = await run(await src('classes.atto'));
  assert.deepEqual([r.value, r.stdout], [42n, 'Account{id=7, balance=100}\n125\n']);
  r = await run(await src('enums.atto'));
  assert.deepEqual([r.value, r.stdout], [7n, 'green after 7 changes\n']);
  const actors = compiler.compile(await src('actors.atto'));
  assert.equal(actors.ok, true);
  assert.deepEqual(actorNames(await WebAssembly.compile(actors.wasm)), ['Counter']);
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
    ['define abstract class P as\nend\n' + main('  return 0;'), 'E_UNSUPPORTED'],
    ['define actor W as\n  receive(int v): int { return v; }\nend\n' + main('  return 0;'), 'E_TYPE'],
    ['define class P as\n  static fnc f(): int { return 1; }\nend\n' + main('  return P.f();'), 'E_PRIVATE'],
    [main('  return 5 % 2;'), 'E_UNSUPPORTED'],
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
  let r = await run('define class N as\n  pub int v: 1\nend\n' + main('  let t = 0;\n  for (let i = 0; i < 1000000; i++) {\n    val n = new N();\n    t = t + n.v;\n  }\n  return t;'));
  assert.equal(r.message, 'E_PANIC: object heap exhausted');
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

test('worker pin matches the receipt and tampered compilers are refused', async () => {
  assert.equal(COMPILER_SHA256, receipt.compiler_sha256);
  assert.equal(COMPILER_BYTES, receipt.compiler_bytes);
  await verifyCompilerBytes(compilerBytes, COMPILER_SHA256, COMPILER_BYTES);
  const tampered = new Uint8Array(compilerBytes);
  tampered[tampered.length - 1] ^= 1;
  await assert.rejects(verifyCompilerBytes(tampered, COMPILER_SHA256, COMPILER_BYTES), /integrity check failed \(sha256\)/);
  await assert.rejects(verifyCompilerBytes(tampered.subarray(1), COMPILER_SHA256, COMPILER_BYTES), /integrity check failed \(size\)/);
});

test('long operator and elif chains are diagnosed, never trap the compiler', async () => {
  for (const op of ['+', '*', '-', '<', '==']) {
    const r = compiler.compile(main(`  return ${Array(9000).fill('1').join(op)};`));
    assert.equal(r.ok, false);
    assert.match(r.diagnostics[0].message, /^E_NESTING/);
  }
  assert.equal((await run(main(`  return ${Array(200).fill('1').join('+')};`))).value, 200n);
  assert.equal((await run(main('  return 42;'))).value, 42n, 'same instance still usable');
});

test('stdout truncation never splits a surrogate pair', () => {
  const out = { text: 'x'.repeat(STDOUT_LIMIT - 1), truncated: false };
  appendCapped(out, '🚀🚀');
  assert.equal(out.truncated, true);
  assert.equal(out.text.length, STDOUT_LIMIT - 1, 'the half emoji is dropped');
  appendCapped(out, 'more');
  assert.equal(out.text.length, STDOUT_LIMIT - 1, 'nothing appended after truncation');
  const exact = { text: '', truncated: false };
  appendCapped(exact, 'a'.repeat(STDOUT_LIMIT));
  assert.deepEqual([exact.text.length, exact.truncated], [STDOUT_LIMIT, false]);
});

test('pinned Wasm compiler does not silently compile unsupported yield* delegation', async () => {
  const source = await readFile(new URL('../examples/preview/generators.atto', import.meta.url), 'utf8');
  const result = compiler.compile(source);
  assert.equal(result.ok, false, 'preview syntax must not silently emit a guest artifact');
  assert.equal(result.wasm, undefined);
  assert.ok(result.diagnostics?.length > 0, 'preview must produce a compiler diagnostic');
});

test('both proposed actor-pipeline spellings fail closed in the shipped browser compiler', async () => {
  const sample = await readFile(new URL('../examples/preview/actor-pipeline.atto', import.meta.url), 'utf8');
  const full = compiler.compile(sample);
  assert.equal(full.ok, false, 'the full actor-pipeline preview is not admitted yet');
  assert.equal('wasm' in full, false);

  // Test each operator independently of emit(), which is itself unsupported.
  const actors = [
    'define actor A as',
    '  receive(ActorMail<int> mail): void { stdio.println(mail.value); }',
    'end',
    'define actor B as',
    '  receive(ActorMail<int> mail): void { stdio.println(mail.value); }',
    'end'
  ].join('\n');
  for (const spelling of ['|', 'pipe']) {
    const source = actors + '\n' + main(
      '  val route = spawn A() ' + spelling + ' spawn B();\n' +
      '  route.send(41);\n' +
      '  return 0;'
    );
    const result = compiler.compile(source);
    assert.equal(result.ok, false, spelling + ' cannot be advertised as executable');
    assert.equal('wasm' in result, false, spelling + ' cannot publish a guest artifact');
    assert.ok(result.diagnostics.length > 0, spelling + ' must provide a diagnostic');
  }
});

test('bundled prime and condition programs avoid removed percent operator in both compiler generations', async () => {
  for (const file of ['primes.atto', 'conditions.atto']) {
    const source = await readFile(new URL('../examples/' + file, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /%/, file + ' must not depend on removed remainder syntax');
    const compiled = compiler.compile(source);
    assert.equal(compiled.ok, true, JSON.stringify(compiled.diagnostics));
    const guest = await execute(compiled.wasm);
    assert.equal(guest.ok, true, file + ': ' + guest.message);
    assert.equal(guest.value, file === 'primes.atto' ? 10n : 11n);
  }
});
