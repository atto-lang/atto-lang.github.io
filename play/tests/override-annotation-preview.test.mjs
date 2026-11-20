import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('uncompiled separate diamond preview uses proposed @Override before visibility and stays preview-only', async () => {
  const source = await readFile(new URL('../examples/preview/diamond-override-annotation.atto', import.meta.url), 'utf8');
  assert.match(source, /^\/\/ SYNTAX PREVIEW/);
  assert.match(source, /NOT executable in the pinned browser Wasm compiler/);
  assert.doesNotMatch(source, /^[ \t]*pub[ \t]+override[ \t]+/m);
  const overrides = [...source.matchAll(/^[ \t]*@Override\r?\n[ \t]*pub[ \t]+describe\(\): string/mg)];
  assert.equal(overrides.length, 3, 'Left, Right and Diamond must all resolve methods via @Override');
  assert.match(source, /define class Diamond extends Left, Right implements Named, Greeter as/);
});

test('runnable diamond example stays executable and uses supported override spelling', async () => {
  const source = await readFile(new URL('../examples/preview/diamond-inheritance.atto', import.meta.url), 'utf8');
  assert.match(source, /^\/\/ LANGUAGE PREVIEW — compiles and runs/);
  assert.equal((source.match(/pub override describe\(\): string/g) || []).length, 3);
  assert.doesNotMatch(source, /^[ \t]*@Override/m);
});
