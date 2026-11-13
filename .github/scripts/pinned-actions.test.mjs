// Guard against mutable GitHub Actions tags in every public Pages workflow.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const workflows = ['approved-playground-pages.yml', 'playground-smoke.yml', 'whitepapers.yml'];
const actionLine = /^\s*-?\s*uses:\s*([^\s#]+)/gm;
const exactAction = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[a-f0-9]{40}$/;

test('each external action is pinned by immutable full SHA across all workflows', async () => {
  let total = 0;
  for (const file of workflows) {
    const yaml = await readFile(new URL('../workflows/' + file, import.meta.url), 'utf8');
    const actions = [...yaml.matchAll(actionLine)].map(match => match[1]);
    assert.ok(actions.length > 0, 'no actions in ' + file);
    for (const ref of actions) {
      assert.match(ref, exactAction, 'mutable action ref in ' + file + ': ' + ref);
      total++;
    }
  }
  assert.ok(total >= 11, 'unexpectedly incomplete workflow action inventory');
});

test('public Pages Jekyll build and whitepaper checkout retain audited tag commits', async () => {
  const approved = await readFile(new URL('../workflows/approved-playground-pages.yml', import.meta.url), 'utf8');
  const whitepapers = await readFile(new URL('../workflows/whitepapers.yml', import.meta.url), 'utf8');
  assert.match(approved, /actions\/jekyll-build-pages@44a6e6beabd48582f863aeeb6cb2151cc1716697/);
  assert.match(whitepapers, /actions\/jekyll-build-pages@44a6e6beabd48582f863aeeb6cb2151cc1716697/);
  assert.match(whitepapers, /actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1/);
});
