import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = file => readFile(new URL(file, root), 'utf8');

test('playground shows exact return-first bullet and begin spelling without promoting an unverified compiler', async () => {
  const [source, arrowGuest, profileText, app, html] = await Promise.all([
    read('examples/preview/return-first-signatures.atto'),
    read('examples/preview/return-first-arrow-guest.atto'),
    read('example-backend-profile.json'),
    read('src/app.js'),
    read('index.html')
  ]);
  assert.match(source, /fnc int • double_answer\(int value\)\s+begin\s+return value \* 2;\s+end/);
  assert.match(source, /int <- answer\(\)\s+begin\s+return double_answer\(21\);\s+end/);
  assert.match(source, /pub fnc main\(\): int \{\s+\/\/[^\n]*\n\s+\/\/[^\n]*\n\s+return answer\(\); \/\/ 42/);
  assert.match(arrowGuest, /fnc int <- double_answer\(int value\)/);
  assert.match(arrowGuest, /begin\s+return value \* 2;\s+end/);
  const profile = JSON.parse(profileText).preview;
  assert.equal(profile.find(item => item.name === 'return-first-signatures')?.expect, 'preview-only');
  assert.equal(profile.find(item => item.name === 'return-first-arrow-guest')?.expect, 'exec');
  assert.match(app, /"preview\/return-first-signatures"/);
  assert.match(html, /value="preview\/return-first-signatures"/);
});

test('source examples reject separator lookalikes and split arrows as noncanonical', async () => {
  const source = await read('examples/preview/return-first-signatures.atto');
  assert.match(source, /INVALID: int < - broken\(\)/);
  assert.match(source, /INVALID: use a different Unicode bullet-looking character/);
});
