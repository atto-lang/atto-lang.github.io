// Actual pinned Rust/Wasm guest execution, not source-only parser checks.
// Cover both body styles, all Ok/Err x Some/None paths, and nonvoid fallthrough.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createCompiler } from '../src/compiler.js';
import { guestImports } from '../src/guest.js';

const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');
const names = ['result-option', 'result-option-end'];
function replaceOnce(source, from, to) {
  assert.equal(source.split(from).length - 1, 1,
    'fixture mutation must match exactly once: ' + from);
  return source.replace(from, to);
}

async function execute(compiler, source, context) {
  const compiled = compiler.compile(source);
  assert.equal(compiled.ok, true, context + ': ' + JSON.stringify(compiled.diagnostics));
  assert.ok(WebAssembly.validate(compiled.wasm), context + ': genuine guest Wasm');
  const module = await WebAssembly.compile(compiled.wasm);
  const output = {text: '', truncated: false};
  const {imports, bind} = guestImports(module, output);
  const instance = await WebAssembly.instantiate(module, imports);
  bind(instance);
  const value = instance.exports.main();
  assert.equal(output.truncated, false, context + ': stdout quota');
  return {value, stdout: output.text};
}

test('Result/Option examples have explicit returns and execute all four ADT combinations', async () => {
  const [compilerBytes, ...sources] = await Promise.all([
    readFile(new URL('../public/atto_compiler.wasm', import.meta.url)),
    ...names.map(name => read('examples/preview/' + name + '.atto'))
  ]);
  const compiler = await createCompiler(compilerBytes);
  const main = 'pub fnc main(): int {';
  for (const source of sources) assert.ok(source.includes(main));
  assert.equal(sources[0].slice(sources[0].indexOf(main)),
    sources[1].slice(sources[1].indexOf(main)),
    'both callable-body styles must teach the same explicit return');

  for (const [i, source] of sources.entries()) {
    const name = names[i];
    assert.match(source, /return match optional_port\(false\) over/);
    assert.match(source, /on Some\(port\) -> port,/);
    assert.match(source, /on None -> 0\s+end;/);
    assert.doesNotMatch(source, /\n  match optional_port\(false\) over/,
      name + ': no bare trailing match posing as an implicit return');

    // Use controlled source variations to execute both Result alternatives
    // and both Option alternatives, not merely parse their unused arms.
    for (const checkedPort of [8080, 0]) {
      for (const present of [false, true]) {
        const context = name + ': checked=' + checkedPort + ', present=' + present;
        let variant = replaceOnce(source, 'match validate_port(8080) over',
          'match validate_port(' + checkedPort + ') over');
        variant = replaceOnce(variant, 'return match optional_port(false) over',
          'return match optional_port(' + present + ') over');
        const outcome = await execute(compiler, variant, context);
        assert.deepEqual(outcome, {
          value: present ? 8080n : 0n,
          stdout: checkedPort > 0 ? '8080\n' : 'port must be positive\n'
        }, context + ': exact output and return');
      }
    }

    // Without the explicit return prefix, a value-producing trailing match
    // cannot be silently treated as the function's return.
    const implicitMatch = replaceOnce(source,
      'return match optional_port(false) over',
      'match optional_port(false) over');
    const rejected = compiler.compile(implicitMatch);
    assert.equal(rejected.ok, false, name + ': implicit match return must reject');
    assert.equal(Object.hasOwn(rejected, 'wasm'), false, name + ': no artifact on error');
    assert.match(rejected.diagnostics?.[0]?.message ?? '', /^E_[A-Z0-9_]+:/);
    assert.ok(rejected.diagnostics[0].line >= 1 && rejected.diagnostics[0].column >= 1);
  }

  // Independent E_RETURN proof: named nonvoid helpers cannot fall through.
  // This avoids mistaking an unsupported match-expression context for return
  // checking: the latter must have its own distinct negative assertion.
  const fallthrough = 'fnc missing(): int { val answer = 42; }\n' +
    'pub fnc main(): int { return missing(); }';
  const rejected = compiler.compile(fallthrough);
  assert.equal(rejected.ok, false);
  assert.equal(Object.hasOwn(rejected, 'wasm'), false);
  assert.match(rejected.diagnostics?.[0]?.message ?? '', /^E_RETURN:/);

  // A negative compilation must not poison the pinned compiler instance.
  assert.deepEqual(await execute(compiler, sources[0], 'recovery'),
    {value: 0n, stdout: '8080\n'});
});
