// Fail closed on mutable or untrusted GitHub Actions in every workflow, including future ones.
// Keep the trusted identity list deliberate: adding an action requires independent source review.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readdir, readFile} from 'node:fs/promises';

const workflowFolder = new URL('../workflows/', import.meta.url);
const TRUSTED_ACTIONS = new Set([
  'actions/checkout',
  'actions/setup-node',
  'actions/jekyll-build-pages',
  'actions/upload-pages-artifact',
  'actions/deploy-pages',
]);
const usesDeclaration = /^[ \t]*(?:-[ \t]*)?uses[ \t]*:/gm;
const usesReference = /^[ \t]*(?:-[ \t]*)?uses[ \t]*:[ \t]*([^\s#]+)/gm;
const exactAction = /^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)@([a-f0-9]{40})$/;

function validateWorkflowActions(yaml, file) {
  const declarations = [...yaml.matchAll(usesDeclaration)];
  const references = [...yaml.matchAll(usesReference)].map(match => match[1]);
  assert.equal(references.length, declarations.length,
    'missing, multiline or unsupported uses: syntax in ' + file);
  assert.ok(references.length > 0, 'workflow contains no audited actions: ' + file);
  for(const ref of references){
    const parsed = exactAction.exec(ref);
    assert.ok(parsed, 'mutable or non-SHA action ref in ' + file + ': ' + ref);
    assert.ok(TRUSTED_ACTIONS.has(parsed[1]),
      'unreviewed third-party GitHub Action in ' + file + ': ' + ref);
  }
  return references.length;
}

test('all existing AND future public Pages workflows use trusted immutable actions', async () => {
  const entries = await readdir(workflowFolder, {withFileTypes:true});
  const files = entries.filter(entry => /\.ya?ml$/.test(entry.name));
  assert.ok(files.length >= 3, 'unexpectedly incomplete public workflow inventory');
  let total = 0;
  for(const entry of files){
    assert.ok(entry.isFile(), 'refusing symlink or non-file workflow: ' + entry.name);
    const yaml = await readFile(new URL(entry.name, workflowFolder), 'utf8');
    total += validateWorkflowActions(yaml, entry.name);
  }
  assert.ok(total >= 11, 'unexpectedly incomplete audited action inventory');
});

test('new workflows cannot sneak in mutable tags, short SHAs or third-party actions', () => {
  const sha = 'a'.repeat(40);
  assert.equal(validateWorkflowActions('steps:\n  - uses: actions/checkout@'+sha, 'new.yml'),1);
  for(const reference of [
    'actions/checkout@v4',
    'actions/checkout@abcdef1',
    'other-org/exfiltrate@'+sha,
    'docker://example:latest',
    './.github/actions/local',
  ]){
    assert.throws(()=>validateWorkflowActions(
      'steps:\n  - uses: '+reference,'new.yml'),
      /mutable or non-SHA|unreviewed third-party/,
      'untrusted action must fail: '+reference);
  }
  assert.throws(()=>validateWorkflowActions('steps:\n  - uses: >-\n    actions/checkout@'+sha,
    'new.yml'),/mutable or non-SHA|unsupported/);
});

test('public Pages Jekyll build and whitepaper checkout retain audited tag commits', async () => {
  const approved = await readFile(new URL('approved-playground-pages.yml', workflowFolder), 'utf8');
  const whitepapers = await readFile(new URL('whitepapers.yml', workflowFolder), 'utf8');
  assert.match(approved, /actions\/jekyll-build-pages@44a6e6beabd48582f863aeeb6cb2151cc1716697/);
  assert.match(whitepapers, /actions\/jekyll-build-pages@44a6e6beabd48582f863aeeb6cb2151cc1716697/);
  assert.match(whitepapers, /actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1/);
});
