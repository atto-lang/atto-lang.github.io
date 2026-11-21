// Runtime regression: explicit return in the published Result/Option examples.
// This must execute genuine guest Wasm with the SHA-pinned compiler, not just
// inspect source or use a JavaScript language evaluator.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createCompiler } from '../src/compiler.js';
import { guestImports } from '../src/guest.js';

const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');
const names = ['result-option', 'result-option-end'];

test('runnable Result/Option examples explicitly return match values', async () => {
  const [compilerBytes, ...sources] = await Promise.all([
    readFile(new URL('../public/atto_compiler.wasm', import.meta.url)),
    ...names.map(name => read('examples/preview/' + name + '.atto'))
  ]);
  const compiler = await createCompiler(compilerBytes);
  const main = 'pub fnc main(): int {';
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

    const compiled = compiler.compile(source);
    assert.equal(compiled.ok, true, name + ': ' + JSON.stringify(compiled.diagnostics));
    assert.ok(WebAssembly.validate(compiled.wasm), name + ': genuine guest Wasm');
    const module = await WebAssembly.compile(compiled.wasm);
    const output = {text: '', truncated: false};
    const { imports, bind } = guestImports(module, output);
    const instance = await WebAssembly.instantiate(module, imports);
    bind(instance);
    assert.equal(instance.exports.main(), 0n, name + ': explicit None return');
    assert.equal(output.text, '8080\n', name + ': Result arm prints the port');
    assert.equal(output.truncated, false);
  }

  // Removing the explicit return must NOT silently return the final match value.
  // Reject with a structured compiler diagnostic and no executable artifact.
  const implicit = sources[0].replace('return match optional_port(false) over',
    'match optional_port(false) over');
  const rejected = compiler.compile(implicit);
  assert.equal(rejected.ok, false, 'bare trailing match must not return from main');
  assert.equal(Object.hasOwn(rejected, 'wasm'), false);
  assert.match(rejected.diagnostics?.[0]?.message ?? '', /^E_[A-Z0-9_]+:/);
});
