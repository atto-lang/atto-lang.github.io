import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { ASSETS } from './package-playground.mjs';

const config = await readFile(new URL('../../_config.yml', import.meta.url), 'utf8');
const excluded = [...config.matchAll(/^  - ([A-Za-z0-9._/-]+)\\s*$/gm)].map(m => m[1]);
const denies = new Set(excluded);
const approvedDocs = new Set(ASSETS.filter(name => name.startsWith('docs/')).map(name => 'play/' + name));

test('legacy Jekyll copies no non-release playground docs and preserves the public compiler contract', async () => {
  assert.match(config, /^exclude:\\s*$/m, 'Jekyll exclude block required');
  assert.equal(denies.size, excluded.length, 'duplicated legacy exclusions');
  const documents = await readdir(new URL('../../play/docs/', import.meta.url), { withFileTypes:true });
  assert.ok(documents.length >= 4, 'site internal-doc inventory must not disappear silently');
  for (const item of documents) {
    assert.ok(item.isFile(), 'unexpected docs directory entry requires explicit review: ' + item.name);
    const path = 'play/docs/' + item.name;
    if (approvedDocs.has(path)) assert.ok(!denies.has(path), 'public reviewed doc is excluded: ' + path);
    else assert.ok(denies.has(path), 'internal doc would be exposed in legacy Pages: ' + path);
  }
  assert.ok(approvedDocs.has('play/docs/COMPILER_CONTRACT.md'));
  for (const path of [
    'play/docs/BACKEND_MAP.md',
    'play/docs/CLOSURES_RELEASE_GATE.md',
    'play/docs/EXAMPLE_BACKEND_PARITY.md'
  ]) assert.ok(denies.has(path), 'observed legacy leak still unexcluded: ' + path);
});

test('legacy exclusions also deny non-public tooling, fixtures and candidate releases', () => {
  for (const path of ['play/tests','play/release-candidates','play/scripts','play/BUILD_RECEIPT.md'])
    assert.ok(denies.has(path), 'unexcluded non-release path: ' + path);
});
