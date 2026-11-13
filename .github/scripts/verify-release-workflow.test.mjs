import { readFileSync } from 'node:fs';
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
  assert.match(deploy,/    permissions:\n      contents: read\n      actions: read\n      pages: write\n      id-token: write/);
  assert.match(deploy,/    environment:\n      name: github-pages/);
});

test('release cannot be dispatched without SHA approval and confirmation',()=>{
  assert.match(workflow,/approved_compiler_sha256:/);
  assert.match(workflow,/confirm_public_disclosure:/);
  // The digest gate lives in check-approved-compiler.mjs (run before staging and
  // again after environment admission); it compares reviewed vs requested SHA
  // and the SHA-256 of the actual compiler bytes.
  assert.equal(workflow.match(/run: node \.github\/scripts\/check-approved-compiler\.mjs/g)?.length, 2);
  assert.match(workflow,/REVIEWED_SHA: \$\{\{ vars\.ATTO_PUBLIC_COMPILER_SHA256 \}\}/);
  const gate=readFileSync(new URL('./check-approved-compiler.mjs',import.meta.url),'utf8');
  assert.match(gate,/reviewedSha !== requestedSha \|\| actual !== reviewedSha/);
  assert.match(gate,/createHash\('sha256'\)\.update\(compilerBytes\)/);
});


test('both required workflows execute on every PR, including docs-only changes',async()=>{
  const smoke=await readFile(new URL('../workflows/playground-smoke.yml',import.meta.url),'utf8');
  for(const [name,text] of [['approved',workflow],['smoke',smoke]]){
    const pr=text.match(/^  pull_request:\s*$/m);
    assert.ok(pr,name+' must use an unconditional pull_request trigger');
    const remaining=text.slice(pr.index+pr[0].length);
    assert.doesNotMatch(remaining,/^\s+paths(?:-ignore)?:/m,
      name+' must not restrict required checks to changed paths');
    assert.match(text,/  push:/);
  }
});

test('environment-admitted deploy rechecks protected main before Pages write',()=>{
  const deploy=workflow.slice(workflow.indexOf('\n  deploy:'));
  assert.match(deploy,/Reverify exact protected main after environment approval/);
  assert.match(deploy,/test "\$\(git rev-parse HEAD\)" = "\$GITHUB_SHA"/);
  const second=deploy.indexOf('node .github/scripts/verify-release-governance.mjs');
  assert.ok(second>=0 && second<deploy.indexOf('- id: deployment'));
});
