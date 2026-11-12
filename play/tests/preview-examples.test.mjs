import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { EXECUTABLE_EXAMPLES, PREVIEW_EXAMPLES, EXAMPLES, isPreviewExample } from '../src/example-catalog.js';
import { ASSETS as PAGES_ASSETS } from '../../.github/scripts/package-playground.mjs';

test('dropdown, catalog and release allowlist agree on every example', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const ids = [...html.matchAll(/<option value="([^"]+)"/g)].map(m => m[1]);
  const builtin = ids.filter(x => x !== 'custom:new');
  assert.deepEqual(builtin, EXAMPLES);
  assert.equal(new Set(EXAMPLES).size, EXAMPLES.length);
  assert.ok(html.includes('Syntax previews — not yet runnable'));
  for (const id of EXAMPLES) {
    assert.ok(PAGES_ASSETS.includes('examples/' + id + '.atto'), id + ' missing from Pages');
    assert.ok((await readFile(new URL('../examples/' + id + '.atto', import.meta.url), 'utf8')).length > 0);
  }
  assert.ok(PAGES_ASSETS.includes('src/example-catalog.js'));
  assert.equal(EXECUTABLE_EXAMPLES.length, 9);
  assert.equal(PREVIEW_EXAMPLES.length, 7);
  for (const id of PREVIEW_EXAMPLES) {
    assert.ok(isPreviewExample(id));
    assert.match(html, new RegExp('<option value="' + id + '">[^<]*\\(preview\\)</option>'));
    assert.match(await readFile(new URL('../examples/' + id + '.atto', import.meta.url), 'utf8'),
      /^\/\/ SYNTAX PREVIEW/);
  }
  for (const id of EXECUTABLE_EXAMPLES) assert.equal(isPreviewExample(id), false);
});

test('preview sources explicitly distinguish traps, result errors, and waiting modes', async () => {
  const src = async id => readFile(new URL('../examples/' + id + '.atto', import.meta.url), 'utf8');
  assert.match(await src('trap'), /\btrap\b/);
  assert.match(await src('result-option'), /Result<.*>|Option<.*>/);
  assert.match(await src('result-option'), /\bOk\(|\bErr\(/);
  assert.match(await src('channel-bounded'), /\bwritech\b|\breadch\b/);
  assert.match(await src('channel-probe'), /\btry readch\b/);
  assert.match(await src('channel-probe'), /\bnb readch\b/);
  assert.match(await src('channel-unbounded'), /\bunbounded\(/);
  assert.match(await src('rx-observable'), /\.subscribe\(/);
  assert.match(await src('rx-interop'), /\.first_task\(/);
  assert.match(await src('rx-interop'), /\bawait\b/);
  assert.match(await src('rx-interop'), /\bfrom_channel\b/);
});
