import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

function loadWorkflow(name) {
  return readFileSync(new URL('../workflows/' + name, import.meta.url), 'utf8');
}
function triggers(yaml) {
  const found = yaml.match(/^on:\s*\n([\s\S]*?)^permissions:/m);
  assert.ok(found, 'expected top-level workflow triggers');
  return found[1];
}
for (const [name, job] of [
  ['approved-playground-pages.yml', 'verify-public-artifact'],
  ['playground-smoke.yml', 'browser-and-guest'],
]) {
  test(name + ' reports required check on every pull request', () => {
    const contents = loadWorkflow(name);
    const on = triggers(contents);
    assert.match(on, /^  pull_request:\s*$/m);
    assert.match(on, /^  push:\s*$/m);
    assert.match(on, /^    branches: \[main\]\s*$/m);
    assert.doesNotMatch(on, /^\s+paths(?:-ignore)?:/m);
    assert.match(contents, new RegExp('^  ' + job + ':', 'm'));
  });
}
test('production deploy remains manual and digest-gated', () => {
  const release = loadWorkflow('approved-playground-pages.yml');
  const on = triggers(release);
  assert.match(on, /^  workflow_dispatch:\s*$/m);
  assert.match(on, /approved_compiler_sha256:/);
  assert.match(on, /confirm_public_disclosure:/);
  assert.match(release, /if: github\.event_name == 'workflow_dispatch'/);
  assert.match(release, /REVIEWED_SHA/);
});
