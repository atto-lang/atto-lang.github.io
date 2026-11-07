import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const text = await readFile(new URL('../CODEOWNERS', import.meta.url), 'utf8');
const REQUIRED_OWNERS = ['@ORESoftware', '@the1mills'];
const REQUIRED_PATTERNS = [
  '*',
  '/.github/CODEOWNERS',
  '/.github/workflows/*',
  '/.github/scripts/*',
  '/_config.yml',
  '/index.html',
  '/assets/*',
  '/play/*',
  '/play/public/*',
  '/play/src/*',
  '/play/tests/*'
];
const SENSITIVE_PATHS = [
  '.github/CODEOWNERS',
  '.github/workflows/approved-playground-pages.yml',
  '.github/workflows/live-public-playground-audit.yml',
  '.github/workflows/unanticipated-release.yml',
  '.github/scripts/package-playground.mjs',
  '.github/scripts/check-pages-source.mjs',
  '.github/scripts/verify-release-codeowners.test.mjs',
  '_config.yml',
  'index.html',
  'assets/site.css',
  'play/index.html',
  'play/styles.css',
  'play/src/app.js',
  'play/src/compiler-pin.js',
  'play/src/formatter-pin.js',
  'play/public/atto_compiler.wasm',
  'play/public/atto_compiler.receipt.json',
  'play/public/oreslang_format.wasm',
  'play/public/oreslang_format.receipt.json',
  'play/tests/browser-e2e.mjs',
  'play/BUILD_RECEIPT.md',
  'play/examples/hello.atto'
];

function parseOwners(source) {
  return source.split(/\r?\n/).map(line => line.trim())
    .filter(line => line && !line.startsWith('#'))
    .map(line => {
      const parts = line.split(/\s+/);
      if (parts.length !== 3) throw new Error('CODEOWNERS must name exactly two reviewers per pattern');
      if (!/^(\*|\/[A-Za-z0-9_.\/-]+(?:\*)?)$/.test(parts[0]))
        throw new Error('Unsupported CODEOWNERS path syntax: ' + parts[0]);
      return { pattern: parts[0], owners: parts.slice(1) };
    });
}
function matches(pattern, path) {
  if (pattern === '*') return true;
  if (pattern.endsWith('/*')) return path.startsWith(pattern.slice(1, -1));
  return pattern === '/' + path;
}
function effectiveOwners(rules, path) {
  let found = [];
  // GitHub evaluates CODEOWNERS patterns in order; the last matching entry wins.
  for (const rule of rules) if (matches(rule.pattern, path)) found = rule.owners;
  return found;
}
function verify(source) {
  const rules = parseOwners(source);
  const patterns = rules.map(rule => rule.pattern);
  assert.equal(new Set(patterns).size, patterns.length, 'Duplicate ownership pattern');
  assert.deepEqual([...patterns].sort(), [...REQUIRED_PATTERNS].sort(), 'Release-control paths must be explicitly owned');
  for (const rule of rules) {
    assert.deepEqual(rule.owners, REQUIRED_OWNERS, 'An overlapping or late rule weakens release owners: ' + rule.pattern);
  }
  for (const path of SENSITIVE_PATHS) {
    assert.deepEqual(effectiveOwners(rules, path), REQUIRED_OWNERS, 'Missing effective owners for ' + path);
  }
  return rules;
}

test('GitHub release workflows, code, compiler Wasm, public assets and CODEOWNERS have effective two-owner review', () => {
  const rules = verify(text);
  assert.ok(rules.length >= 10);
  assert.ok(text.includes('cannot self-approve'), 'CODEOWNERS must document independent-review behavior');
});

test('CODEOWNERS cannot silently lose a sensitive path, an owner or its rule ordering', () => {
  const variants = [
    text.replace('/.github/CODEOWNERS @ORESoftware @the1mills', ''),
    text.replace('/.github/workflows/* @ORESoftware @the1mills', ''),
    text.replace('/play/public/* @ORESoftware @the1mills', ''),
    text.replace('/play/tests/* @ORESoftware @the1mills', ''),
    text.replace('/play/public/* @ORESoftware @the1mills', '/play/public/* @the1mills'),
    text.replace('* @ORESoftware @the1mills', '* @ORESoftware'),
    text + '\n/play/src/* @the1mills\n',
    text.replace('/index.html @ORESoftware @the1mills', '/index.html @ORESoftware @the1mills\n/index.html @ORESoftware @the1mills')
  ];
  for (const [index, variant] of variants.entries()) {
    assert.throws(() => verify(variant), undefined, 'Ownership mutation ' + index + ' must fail');
  }
});

test('An unrelated existing path also retains a non-self-approved review option', () => {
  const rules = verify(text);
  for (const path of ['docs/overview.md', 'README.md', 'play/examples/new.atto']) {
    assert.deepEqual(effectiveOwners(rules, path), REQUIRED_OWNERS);
  }
});
