import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createCompiler } from '../src/compiler.js';
const compilerBytes = await readFile(new URL('../public/atto_compiler.wasm', import.meta.url));
const compiler = await createCompiler(compilerBytes);
function compile(body) { return compiler.compile(`fnc main() -> int { ${body} }`); }
async function run(result) {
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.equal(WebAssembly.validate(result.wasm), true);
  const module = await WebAssembly.compile(result.wasm);
  assert.deepEqual(WebAssembly.Module.imports(module), []);
  assert.deepEqual(WebAssembly.Module.exports(module), [{name: 'main', kind: 'function'}]);
  const instance = await WebAssembly.instantiate(module, {});
  return instance.exports.main();
}
test('compiler itself is WebAssembly with no host imports', async () => {
  assert.equal(WebAssembly.validate(compilerBytes), true);
  const mod = await WebAssembly.compile(compilerBytes);
  assert.deepEqual(WebAssembly.Module.imports(mod), []);
});
test('real Atto to Wasm to execution yields 42', async () => {
  assert.equal(await run(compile('const int x = 6; int y = 7; return x * y;')), 42);
});
test('negative and precedence semantics', async () => {
  assert.equal(await run(compile('return 5 + 6 * 7;')), 47);
  assert.equal(await run(compile('return (5 + 6) * 7;')), 77);
  assert.equal(await run(compile('return -7 + 10;')), 3);
  assert.equal(await run(compile('return 13 / 4;')), 3);
  assert.equal(await run(compile('return 13 - 25;')), -12);
});
test('all three immutable declaration spellings agree', async () => {
  const outputs = [];
  for (const stmt of ['int x = 7;', 'const x = 7;', 'const int x = 7;']) {
    outputs.push(await run(compile(`${stmt} return x * 6;`)));
  }
  assert.deepEqual(outputs, [42, 42, 42]);
});
test('explicit let and mut rebinding works', async () => {
  assert.equal(await run(compile('let int x = 7; x = x * 6; return x;')), 42);
  assert.equal(await run(compile('mut x = 41; x = x + 1; return x;')), 42);
});
test('compilation produces source-dependent Wasm artifacts', async () => {
  const first = compile('return 41;');
  const second = compile('return 42;');
  assert.notDeepEqual(first.wasm, second.wasm);
  assert.equal(await run(first), 41);
  assert.equal(await run(second), 42);
});
test('invalid programs fail closed and never return wasm', () => {
  for (const [source, code] of [
    ['fnc main() -> int { int x = 5; x = 6; return x; }', 'E_IMMUTABLE'],
    ['fnc main() -> int { return foo; }', 'E_UNBOUND'],
    ['fnc main() -> int { return 2 + ; }', 'E_EXPRESSION'],
    ['fnc main() -> int { return 42 }', 'E_SEMICOLON'],
    ['fnc main() -> int { return 42;', 'E_ENTRY'],
    ['fnc main() -> int { int x = 1; int x = 2; return x; }', 'E_DUPLICATE'],
    ['fnc main() -> int { return 42; } malicious', 'E_TRAILING'],
    ['fnc main() -> int { return 2147483648; }', 'E_INTEGER_RANGE'],
    ['fnc main() -> int { return 2 ** 8; }', 'E_EXPRESSION'],
    ['fnc main() -> int { return 4 % 3; }', 'E_TOKEN'],
    ['fnc main() -> int { print(42); return 0; }', 'E_UNBOUND'],
    ['fnc main() -> int { return 0; }\u0000', 'E_NUL'],
    ['fnc main() -> int { return 1; } fnc other() -> int { return 2; }', 'E_TRAILING'],
    ['fnc main() -> int { let x = 1; return x; x=2; }', 'E_RETURN'],
    ['fnc main() -> int { }', 'E_RETURN']
  ]) {
    const r = compiler.compile(source);
    assert.equal(r.ok, false, source);
    assert.match(r.diagnostics[0].message, new RegExp(code), source);
    assert.equal('wasm' in r, false, source);
  }
});
test('every malformed source keeps line-column diagnostics', () => {
  const r = compiler.compile('fnc main() -> int {\n  int x = 1;\n  x = 2;\n  return x;\n}');
  assert.equal(r.ok, false);
  assert.equal(r.diagnostics[0].line, 3);
  assert.equal(r.diagnostics[0].column, 3);
});
test('strict UTF-8 source budget and recovery after compiler error', async () => {
  const big = ' '.repeat(4100);
  assert.equal(compiler.compile(big).ok, false);
  assert.equal(await run(compile('return 42;')), 42);
});
test('generated i32 math agrees for 100 different source programs', async () => {
  for (let i = 0; i < 100; i++) {
    const a = (i * 1103) % 19001;
    const b = (i * 13) % 1021;
    assert.equal(await run(compile(`let x = ${a}; x = x + ${b}; return x * 3 - 5;`)), (a + b) * 3 - 5);
  }
});
test('runtime divide-by-zero is trapped, never a compiler bypass', async () => {
  const r = compile('return 42 / (3 - 3);');
  assert.equal(r.ok, true);
  const { instance } = await WebAssembly.instantiate(r.wasm, {});
  assert.throws(() => instance.exports.main(), WebAssembly.RuntimeError);
});
