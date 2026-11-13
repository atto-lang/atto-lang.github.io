import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

// Defense in depth while legacy GitHub Pages is still configured. This test
// cannot certify the actual Pages setting or replace the live HTTPS audit.
test('legacy Pages exclusion list blocks known non-release playground paths', async () => {
  const body = await readFile(new URL('../../_config.yml', import.meta.url), 'utf8');
  assert.match(body, /^exclude:\s*$/m);
  const entries = body.split('\n').flatMap(line => {
    const match = /^\s*-\s+([^#\s]+)\s*$/.exec(line);
    return match ? [match[1]] : [];
  });
  for (const required of [
    'README.md', 'play/tests', 'play/package.json',
    'play/package-lock.json', 'play/scripts', 'play/BUILD_RECEIPT.md'
  ]) assert.ok(entries.includes(required), 'missing legacy exclusion: ' + required);
  for (const needed of [
    'play/index.html', 'play/src', 'play/public', 'play/styles.css', 'play/examples',
    'index.html', 'assets'
  ]) assert.ok(!entries.includes(needed), 'legacy exclusion would break site: ' + needed);
  assert.ok(body.includes('Settings > Pages > Source: GitHub Actions'));
});
