// Source-level contract regression only. The independently pinned compiler gate
// verifies the legacy executable guest and requires canonical preview rejection.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');

test('trap picker distinguishes canonical Result from legacy pinned Option', async () => {
  const [html, app, profileText, canonical, legacy] = await Promise.all([
    read('index.html'),
    read('src/app.js'),
    read('example-backend-profile.json'),
    read('examples/preview/trap-result.atto'),
    read('examples/preview/trap.atto')
  ]);
  const profile = JSON.parse(profileText);
  const byName = new Map(profile.preview.map(x => [x.name, x]));
  assert.equal(byName.get('trap').expect, 'exec',
    'legacy pinned binary still has its own genuine executable oracle');
  assert.equal(byName.get('trap-result').expect, 'preview-only',
    'canonical Result contract must not be called executable before a new compiler pin');

  assert.match(html, /value="preview\/trap">trap — legacy Option behavior \(pinned compiler only\)/);
  assert.match(html, /value="preview\/trap-result">trap — canonical Result contract \(preview only\)/);
  assert.match(app, /selector\.value === 'preview\/trap'/);
  assert.match(app, /selector\.value === 'preview\/trap-result'/);
  assert.match(app, /The pinned Rust\/Wasm binary does not compile this preview yet/);

  assert.match(legacy, /Option<Result<int, String>> success = trap checked_id\(5\)/,
    'retain exact historical old-byte fixture until approved pin replacement');
  assert.match(canonical, /Result<int, Error> success = trap checked_id\(5\)/);
  assert.match(canonical, /Result<int, Error> invalid = trap checked_id\(-1\)/);
  assert.match(canonical, /Result<int, Error> thrown = trap checked_or_throw\(13\)/);
  assert.match(canonical, /Result<int, Error> plain = trap count_or_throw\(7\)/);
  assert.match(canonical, /Result<Option<int>, Error> absent = trap optional_id\(false\)/);
  assert.match(canonical, /throw! Error\("unexpected id"\)/);
  assert.match(canonical, /on Ok\(id\)/);
  assert.match(canonical, /on Err\(error\)/);
  assert.match(canonical, /on Ok\(None\)/);
  assert.doesNotMatch(canonical, /val Option<Result</,
    'do not document the superseded Option-returning trap as canonical');
  assert.doesNotMatch(canonical, /on Some\(result\)/,
    'the outer container must never be Option');
  assert.doesNotMatch(canonical, /= trap .*;\s*\/\/ Some\(/,
    'do not teach nested Some(Ok(...))');
  assert.match(canonical, /E_TRAP_ERROR_JOIN/,
    'String error operands need a provably lossless join or rejection');
});
