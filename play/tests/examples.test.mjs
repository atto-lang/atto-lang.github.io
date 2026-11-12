import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ASSETS } from '../../.github/scripts/package-playground.mjs';

const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');

test('conditional Fibonacci remains intact and match variant terminates with end', async () => {
  const [original, matched] = await Promise.all([read('examples/fib.atto'), read('examples/fib-match.atto')]);
  assert.match(original, /if n < 2 then\s+return n;\s+fi/);
  assert.doesNotMatch(original, /return match n over/);
  assert.match(matched, /return match n over\s+on 0 -> 0,\s+on 1 -> 1,\s+default ->\s+fib\(n - 1\) \+ fib\(n - 2\),\s+end/);
  assert.match(matched, /return fib\(12\);/);
  assert.equal(matched.split('\n').filter(line => line.trim() === 'end').length, 1, 'match has a single end terminator');
});

test('pattern matching is a distinct selectable built-in and a release asset', async () => {
  const [html, app] = await Promise.all([read('index.html'), read('src/app.js')]);
  assert.match(html, /<option value="fib">Recursion<\/option><option value="fib-match">Fibonacci — pattern matching \(preview\)<\/option>/);
  assert.match(app, /'hello', 'fib', 'fib-match', 'primes'/);
  assert.ok(ASSETS.includes('examples/fib.atto'));
  assert.ok(ASSETS.includes('examples/fib-match.atto'));
});
