// Source syntax regression independent of the pinned public browser compiler.
// Callable TYPE declarations use =>; lambda BODY boundaries use ->.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const preview = new URL('../examples/preview/lambdas-advanced.atto', import.meta.url);
const app = new URL('../src/app.js', import.meta.url);
const catalog = new URL('./example-catalog.test.mjs', import.meta.url);

test('callable declarations use fat arrows, lambda bodies retain skinny arrows', async () => {
  const source = await readFile(preview, 'utf8');
  assert.match(source, /fnc apply_twice\(fnc\(int\)\s*=>\s*int operation/);
  assert.match(source, /fnc make_adder\(int offset\):\s*fnc\(int\)\s*=>\s*int/);
  assert.match(source, /return \|n\|\s*:\s*int\s*->\s*n \+ offset;/);
  assert.match(source, /val double_it = \|n\|\s*:\s*int\s*->\s*n \* 2;/);
  assert.doesNotMatch(source, /\bfnc\([^)]*\)\s*->/,
    'skinny arrows must never appear in callable type declarations');
  assert.doesNotMatch(source, /\|[^|\n]*\|\s*=>/,
    'fat arrows must never replace lambda body delimiters');
});

test('preview is still gated and the catalog does not forbid all fat arrows', async () => {
  const [code, checks] = await Promise.all([
    readFile(app, 'utf8'), readFile(catalog, 'utf8')
  ]);
  assert.match(code, /const PREVIEW_EXAMPLES = new Set\(\[[^\n]*"preview\/lambdas"/);
  assert.match(code, /runButton\.disabled = value;/);
  assert.match(code, /compileButton\.disabled = value;/);
  assert.match(code, /formatButton\.disabled = value \|\| PREVIEW_EXAMPLES\.has\(selector\.value\)/);
  assert.match(checks, /assert\.doesNotMatch\(source, \/\\\|/);
  assert.doesNotMatch(checks, /assert\.doesNotMatch\(source, \/\=\>\/,/,
    'do not reject the required callable type fat-arrow token globally');
});
