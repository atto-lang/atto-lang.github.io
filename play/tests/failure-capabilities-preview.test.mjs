import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createCompiler } from '../src/compiler.js';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('effects preview describes three independent failure capability contracts', async () => {
  const source = await read('../examples/preview/effects.atto');
  const html = await read('../index.html');
  const app = await read('../src/app.js');
  assert.match(source, /^\/\/ SYNTAX PREVIEW/);
  for (const trait of ['Throwable', 'Raisable', 'Panicable'])
    assert.match(source, new RegExp('\\b' + trait + '\\b'));
  assert.match(source, /BOTH extend Error and implement/);
  assert.match(source, /throw value -> Throwable; raise value -> Raisable; panic value -> Panicable/);
  assert.match(source, /fnc checked_value\(bool valid\): int throws\(Error\)/);
  assert.match(source, /fnc escalate\(\): void raises\(Error\)/);
  assert.match(source, /fnc fatal_error\(\): void panics\(Error\)/);
  assert.match(source, /pure fnc add\(int a, int b\): int/);
  assert.match(source, /pub suspends fnc main\(\): int using io, suspend/);
  assert.match(source, /does NOT assert support/);
  const previewGroup = html.match(/<optgroup label="Language previews — syntax only \(compiler diagnostics\)">([\s\S]*?)<\/optgroup>/)?.[1];
  assert.ok(previewGroup, 'syntax-only preview group must be visible');
  assert.match(previewGroup, /value="preview\/effects"/);
  assert.match(app, /"preview\/effects"/);
});

test('pinned compiler rejects genuinely unsupported failure syntax without emitting wasm', async () => {
  const compiler = await createCompiler(await readFile(new URL('../public/atto_compiler.wasm', import.meta.url)));
  const compile = src => compiler.compile(src);
  const main = action => `pub fnc main(): int { ${action} return 0; }`;

  // Non-Error operands are invalid; a rejected compilation must never
  // disclose a stale or executable guest artifact.
  for (const expr of ['throw 42;', 'throw "text";']) {
    const result = compile(main(expr));
    assert.equal(result.ok, false, 'must reject: ' + expr);
    assert.equal(Object.hasOwn(result, 'wasm'), false, 'no artifact for: ' + expr);
    assert.match(result.diagnostics?.[0]?.message ?? '', /^E_[A-Z0-9_]+:/);
  }

  // The pinned browser compiler already supports a restricted unwind profile:
  // the executable defer/recover preview compiles and runs using raise/throw.
  // Do not incorrectly reject every raise, or claim general feature parity.
  const realUnwind = compile(await read('../examples/preview/defer-recover.atto'));
  assert.equal(realUnwind.ok, true, JSON.stringify(realUnwind.diagnostics));
  assert.ok(WebAssembly.validate(realUnwind.wasm));

  const effectClause = compile('fnc f(): int throws(Error) { return 42; } ' + main(''));
  // Some effect syntax may be supported by the pinned subset. Any failure
  // must be structured and must never return stale Wasm bytes.
  if (!effectClause.ok) {
    assert.equal(Object.hasOwn(effectClause, 'wasm'), false);
    assert.match(effectClause.diagnostics?.[0]?.message ?? '', /^E_[A-Z0-9_]+:/);
  } else {
    assert.ok(WebAssembly.validate(effectClause.wasm));
  }
});
