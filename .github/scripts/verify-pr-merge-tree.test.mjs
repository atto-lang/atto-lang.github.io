import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const workflow=await readFile(new URL('../workflows/pr-build-test-security.yml',import.meta.url),'utf8');
const releaseWorkflow=await readFile(new URL('../workflows/approved-playground-pages.yml',import.meta.url),'utf8');
const start=workflow.indexOf('      - name: Check out proposed PR merge commit');
const end=workflow.indexOf('  # Compatibility check:',start);
const section=start>=0&&end>start?workflow.slice(start,end):'';

test('required PR validation checks exact HEAD and proposed merge tree',()=>{
  assert.ok(start>0 && end>start,'the PR merge test must precede the fail-closed legacy gate');
  assert.ok(workflow.indexOf('Require exact source SHA and execute release-package tests')<start);
  assert.ok(workflow.includes('test "$(git rev-parse HEAD)" = "$EXPECTED_HEAD"'),
    'raw PR head must be pinned before testing the proposed merge');
  assert.ok(workflow.includes('github.event.pull_request.head.sha || github.sha'));
  assert.ok(workflow.includes('pull_request:'),'required workflow must run on every PR');
  assert.ok(!/pull_request:\n\s+paths:/.test(workflow),'required CI must not have a path filter');
});

test('merge checkout pins the GitHub-synthesized commit and does not retain credentials',()=>{
  assert.match(section,/if: github\.event_name == 'pull_request'/);
  assert.match(section,/ref: \$\{\{ github\.sha \}\}/);
  assert.match(section,/path: \.pr-merge-check/);
  assert.match(section,/persist-credentials: false/);
  assert.match(section,/fetch-depth: 2/);
  assert.match(section,/working-directory: \.pr-merge-check/);
});

test('merge commit has two ordered parents and pins the exact PR head',()=>{
  for(const pair of [
    'EXPECTED_MERGE_SHA: ${{ github.sha }}',
    'EXPECTED_PR_HEAD_SHA: ${{ github.event.pull_request.head.sha }}',
    'EXPECTED_PR_BASE_SHA: ${{ github.event.pull_request.base.sha }}',
    'test "$EXPECTED_MERGE_SHA" != "$EXPECTED_PR_HEAD_SHA"',
    'test "$(git rev-parse HEAD)" = "$EXPECTED_MERGE_SHA"',
    'MERGE_PARENTS="$(git show -s --format=%P HEAD)"',
    'set -- $MERGE_PARENTS',
    'test "$#" -eq 2',
    'test "$2" = "$EXPECTED_PR_HEAD_SHA"',
    'if [ "$1" != "$EXPECTED_PR_BASE_SHA" ]; then',
    'git rev-parse HEAD^{tree}'
  ]) assert.ok(section.includes(pair),'missing immutable merge admission: '+pair);
});

test('integrated tests execute after parent check and before artifact upload',()=>{
  const parentCheck=section.indexOf('git show -s --format=%P HEAD');
  for(const command of [
    'node --test .github/scripts/*.test.mjs',
    'npm --prefix play test',
    'npm --prefix play run test:browser',
    'npm --prefix play run test:e2e',
    'node .github/scripts/package-playground.mjs',
    'ATTO_STATIC_ROOT="$PWD/_site/play" npm --prefix play run test:e2e'
  ]) {
    const pos=section.indexOf(command);
    assert.ok(pos>parentCheck,'missing integrated execution after merge pin: '+command);
  }
});

test('synthetic PR merge is verified but never uploaded as a release artifact',()=>{
  assert.doesNotMatch(workflow,/actions\/upload-pages-artifact|actions\/deploy-pages/,
    'PR verification must not publish candidate bytes');
  assert.match(releaseWorkflow,/uses: actions\/upload-pages-artifact@/);
  assert.match(releaseWorkflow,/path: _site/);
  assert.match(releaseWorkflow,/github\.event_name == 'workflow_dispatch'/);
  assert.match(releaseWorkflow,/Recheck compiler approval after protected environment admission/);
});

test('privileged Pages deployment requires manual dispatch on canonical main and a reviewed compiler',()=>{
  const deployIndex=releaseWorkflow.indexOf('\n  deploy:\n');
  assert.ok(deployIndex>0,'deploy job must be present');
  const deploy=releaseWorkflow.slice(deployIndex);
  assert.match(deploy,/if: github\.event_name == 'workflow_dispatch' && github\.ref == 'refs\/heads\/main' && github\.repository == 'atto-lang\/atto-lang.github.io' && inputs\.confirm_public_disclosure == 'yes'/);
  assert.match(deploy,/environment:\n\s+name: github-pages/);
  assert.match(deploy,/node \.github\/scripts\/check-pages-source\.mjs/);
  assert.match(deploy,/node \.github\/scripts\/check-deployment-environment\.mjs/);
  assert.match(deploy,/node \.github\/scripts\/check-approved-compiler\.mjs/);
  assert.match(deploy,/uses: actions\/deploy-pages@/);
  assert.equal((releaseWorkflow.match(/uses: actions\/deploy-pages@/g)||[]).length,1,
    'only one independently gated Pages deployment action is permitted');
});

test('PR validation is read-only and the legacy required check mirrors its result',()=>{
  const validation=workflow.slice(workflow.indexOf('  build-test-security:'),
    workflow.indexOf('  # Compatibility check:'));
  assert.match(validation,/permissions:\n      contents: read\n/);
  assert.doesNotMatch(validation,/      pages: write|      id-token: write/);
  assert.doesNotMatch(workflow,/pull_request_target:/);
  assert.match(workflow,/  verify-public-artifact:\n    needs: build-test-security\n    if: always\(\)/);
  assert.match(workflow,/PR_GATE_RESULT/);
  assert.match(workflow,/test "\$PR_GATE_RESULT" = "success"/);
  const verification=releaseWorkflow.slice(releaseWorkflow.indexOf('  verify-public-artifact:'),
    releaseWorkflow.indexOf('\n  deploy:'));
  assert.match(verification,/permissions:\n      contents: read\n      actions: read\n      pages: read/);
  assert.doesNotMatch(verification,/      (pages|actions|contents): write/);
  assert.match(verification,/Verify Pages source cannot auto-publish from a branch/);
  assert.match(verification,/Verify deployment environment has independent required reviewers/);
  assert.match(verification,/Enforce independently approved public compiler digest on deploy/);
});
