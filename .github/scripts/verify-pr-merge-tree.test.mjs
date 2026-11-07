import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const workflow=await readFile(new URL('../workflows/approved-playground-pages.yml',import.meta.url),'utf8');
const start=workflow.indexOf('      - name: Check out proposed PR merge commit');
const end=workflow.indexOf('      - uses: actions/upload-pages-artifact@',start);
const section=start>=0&&end>start?workflow.slice(start,end):'';

test('required release check exercises both exact PR HEAD and its proposed merge tree',()=>{
  assert.ok(start>0 && end>start,'the PR merge test must precede artifact upload');
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

test('merge commit must have exactly the event base and head as ordered parents',()=>{
  for(const pair of [
    'EXPECTED_MERGE_SHA: ${{ github.sha }}',
    'EXPECTED_PR_HEAD_SHA: ${{ github.event.pull_request.head.sha }}',
    'EXPECTED_PR_BASE_SHA: ${{ github.event.pull_request.base.sha }}',
    'test "$EXPECTED_MERGE_SHA" != "$EXPECTED_PR_HEAD_SHA"',
    'test "$(git rev-parse HEAD)" = "$EXPECTED_MERGE_SHA"',
    'test "$(git show -s --format=%P HEAD)" = "$EXPECTED_PR_BASE_SHA $EXPECTED_PR_HEAD_SHA"',
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

test('synthetic PR merge cannot become the approved public release artifact',()=>{
  const upload=workflow.slice(end,end+240);
  assert.match(upload,/path: _site/);
  assert.ok(!upload.includes('.pr-merge-check'),'synthetic merge must never be uploaded');
  assert.match(workflow,/github\.event_name == 'workflow_dispatch'/);
  assert.match(workflow,/Recheck compiler approval after protected environment admission/);
});
