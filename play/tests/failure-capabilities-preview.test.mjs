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
  assert.match(html, /Language previews — not executable yet/);
  assert.match(html, /value="preview\/effects"/);
  assert.match(app, /"preview\/effects"/);
});

test('published pinned compiler rejects unsupported failure constructs without emitting wasm', async () => {
  const compiler = await createCompiler(await readFile(new URL('../public/atto_compiler.wasm', import.meta.url)));
  const compile = src => compiler.compile(src);
  const main = action => `pub fnc main(): int { ${action} return 0; }`;
  for (const expr of ['throw 42;', 'throw "text";', 'raise Error("bad");', 'panic Error("bad");']) {
    const result = compile(main(expr));
    assert.equal(result.ok, false, 'must reject: ' + expr);
    assert.equal('wasm' in result, false, 'no artifact for: ' + expr);
    assert.ok(result.diagnostics?.length > 0, 'diagnostic for: ' + expr);
  }
  const effectClause = compile('fnc f(): int throws(Error) { return 42; } ' + main(''));
  assert.equal(effectClause.ok, false, 'annotation not yet browser-admitted');
  assert.equal('wasm' in effectClause, false);
  // This exact reviewed public compiler receipt predates Rust's narrow
  // ordinary-throw support. Never infer source-branch acceptance from the
  // pinned public binary or silently emit unreviewed guest Wasm.
  const ordinary = compile('fnc fail(): int { throw Error("guest failure"); } ' + main('return 42;'));
  assert.equal(ordinary.ok, false, 'pinned browser artifact does not support guest throw');
  assert.equal('wasm' in ordinary, false);
  assert.match(ordinary.diagnostics[0].message, /^E_UNSUPPORTED:/);
});
