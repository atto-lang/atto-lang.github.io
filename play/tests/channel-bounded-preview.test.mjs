import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const fromPlayRoot = relativePath => new URL('../' + relativePath, import.meta.url);

test('bounded-channel producer task explicitly returns awaited void completion', async () => {
  const sample = await readFile(fromPlayRoot('examples/preview/channel-bounded.atto'), 'utf8');

  assert.match(sample, /^\/\/ SYNTAX PREVIEW\b/m);
  assert.match(sample, /suspends fnc produce\(Channel<int> ch\): void \{/);
  assert.match(sample, /val producer = task \{\s*return await produce\(ch\);\s*\};/);
  assert.doesNotMatch(sample, /val producer = task \{\s*await produce\(ch\);\s*\};/);

  // With capacity two, joining before consuming all three writes can deadlock.
  assert.match(sample, /Channel<int>\.bounded\(2\)/);
  assert.match(sample, /for \(let i = 1; i <= 3; i\+\+\) do\s*writech ch, i;/);
  assert.match(sample, /for \(let i = 0; i < 3; i\+\+\) do\s*total \+= readch ch;/);
  const producer = sample.indexOf('val producer = task {');
  const consume = sample.indexOf('val sum = await consume(ch);');
  const join = sample.indexOf('await producer;');
  const returnSum = sample.indexOf('return sum;');
  assert.ok(producer >= 0 && producer < consume && consume < join && join < returnSum);
  assert.match(sample, /ch\.close\(\);/);
});

test('bounded-channel sample stays preview-only until compiler/runtime conformance exists', async () => {
  const [html, app, source, contract] = await Promise.all([
    readFile(fromPlayRoot('index.html'), 'utf8'),
    readFile(fromPlayRoot('src/app.js'), 'utf8'),
    readFile(fromPlayRoot('examples/preview/channel-bounded.atto'), 'utf8'),
    readFile(fromPlayRoot('docs/COMPILER_CONTRACT.md'), 'utf8'),
  ]);

  assert.match(html, /<option value="preview\/channel-bounded">Bounded channels<\/option>/);
  assert.match(app, /const PREVIEW_EXAMPLES = new Set\([^;]*"preview\/channel-bounded"/);
  assert.match(app, /const preview = PREVIEW_EXAMPLES\.has\(selector\.value\);/);
  assert.match(app, /const controlsDisabled = working \|\| formatting \|\| preview;/);
  assert.match(app, /runButton\.disabled = controlsDisabled;/);
  assert.match(source, /third send suspends until a receiver/i);
  assert.match(source, /Closing wakes receivers/i);
  assert.match(contract, /### Bounded channel \+ task completion \(preview-only\)/);
  assert.match(contract, /browser compiler does not implement or validate this contract/i);
});
