import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const content = await readFile(new URL('../CODEOWNERS', import.meta.url), 'utf8');
const rules = content.split(/\r?\n/).map(line => line.trim())
  .filter(line => line && !line.startsWith('#'))
  .map(line => {
    const parts = line.split(/\s+/);
    assert.equal(parts.length, 2, 'Each ownership line must specify one pattern and one reviewer');
    assert.equal(parts[1], '@ORESoftware', 'Release-control owners must be independently authorized');
    assert.match(parts[0], /^\/[A-Za-z0-9_.\/-]+$/, 'Use simple, auditable paths, not ambiguous globs');
    return { pattern: parts[0], owner: parts[1] };
  });

function matchingOwner(file) {
  let owner = null;
  for (const rule of rules) {
    const match = rule.pattern.endsWith('/')
      ? file.startsWith(rule.pattern.slice(1))
      : file === rule.pattern.slice(1);
    if (match) owner = rule.owner; // GitHub's last matching CODEOWNERS entry wins.
  }
  return owner;
}

test('independent codeowner covers workflows, publishing, public compiler and site assets', () => {
  for (const path of [
    '.github/CODEOWNERS',
    '.github/workflows/approved-playground-pages.yml',
    '.github/workflows/playground-smoke.yml',
    '.github/workflows/future-release.yml',
    '.github/scripts/package-playground.mjs',
    '.github/scripts/check-pages-source.mjs',
    '_config.yml',
    'play/public/atto_compiler.wasm',
    'play/public/atto_compiler.receipt.json',
    'play/public/oreslang_format.wasm',
    'play/src/compiler-pin.js',
    'play/src/formatter-pin.js',
    'play/src/app.js',
    'play/tests/browser-e2e.mjs',
    'index.html',
    'assets/site.css'
  ]) {
    assert.equal(matchingOwner(path), '@ORESoftware', 'Missing independent owner for ' + path);
  }
});

test('ownership rules are unique, explicit, and cannot be silently removed', () => {
  assert.equal(new Set(rules.map(rule => rule.pattern)).size, rules.length, 'Duplicate CODEOWNERS paths');
  assert.deepEqual(rules.map(rule => rule.pattern).sort(), [
    '/.github/CODEOWNERS',
    '/.github/workflows/',
    '/.github/scripts/',
    '/_config.yml',
    '/play/',
    '/index.html',
    '/assets/'
  ].sort());
});
