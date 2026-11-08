import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const workflow = await readFile(
  new URL('../workflows/approved-playground-pages.yml', import.meta.url),
  'utf8'
);

test('deployment verifier has only the necessary governance read scopes',()=>{
  // Keep explicit read scopes with the job, not with all workflows or the
  // deploy job. Unspecified GITHUB_TOKEN permissions default to none.
  assert.match(workflow,
    /  verify-public-artifact:\n    runs-on: ubuntu-24\.04\n(?:    #[^\n]*\n)*    permissions:\n      contents: read\n      actions: read\n      pages: read\n    steps:/);
  const verify=workflow.slice(workflow.indexOf('  verify-public-artifact:'),
    workflow.indexOf('\n  deploy:'));
  assert.doesNotMatch(verify,/      (pages|actions|contents): write/);
  assert.match(verify,/      - name: Verify live GitHub branch, Pages, and environment governance\n        if: github\.event_name == 'workflow_dispatch'/);
  assert.match(verify,/        run: node \.github\/scripts\/verify-release-governance\.mjs/);
});

test('Pages write and identity token are confined to guarded deploy job',()=>{
  const deploy=workflow.slice(workflow.indexOf('\n  deploy:'));
  assert.match(deploy,/    if: github\.event_name == 'workflow_dispatch' && github\.ref == 'refs\/heads\/main'/);
  assert.match(deploy,/    permissions:\n      pages: write\n      id-token: write/);
  assert.match(deploy,/    environment:\n      name: github-pages/);
});

test('release cannot be dispatched without SHA approval and confirmation',()=>{
  assert.match(workflow,/approved_compiler_sha256:/);
  assert.match(workflow,/confirm_public_disclosure:/);
  assert.match(workflow,/test "\$REVIEWED_SHA" = "\$REQUESTED_SHA"/);
  assert.match(workflow,/test "\$REVIEWED_SHA" = "\$\(sha256sum play\/public\/atto_compiler\.wasm \| cut -d' ' -f1\)"/);
});
