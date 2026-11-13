import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflow = await readFile(new URL('../workflows/live-public-playground-audit.yml',import.meta.url),'utf8');

test('one canonical auditor runs PR unit contracts and live deployed-site verification separately',()=>{
  for(const required of [
    'pull_request:', 'workflow_run:', 'schedule:', 'workflow_dispatch:',
    'auditor-contracts:', 'live-http-audit:',
    'node --test .github/scripts/audit-live-playground.test.mjs',
    'node .github/scripts/audit-live-playground.mjs',
    "github.event_name == 'pull_request'",
    "github.event_name == 'workflow_run'",
    "github.event.workflow_run.event == 'workflow_dispatch'",
    "github.event.workflow_run.head_branch == 'main'",
    "github.event.workflow_run.conclusion == 'success'"
  ]) assert.ok(workflow.includes(required),'missing required event gate: '+required);
  assert.ok(workflow.indexOf('auditor-contracts:')<workflow.indexOf('live-http-audit:'));
  assert.equal((workflow.match(/live-http-audit:/g)||[]).length,1);
});

test('PR checkout binds source to exact reviewed head and never tries to audit unshipped PR deployment',()=>{
  assert.ok(workflow.includes('ref: ${{ github.event.pull_request.head.sha }}'));
  assert.ok(workflow.includes('EXPECTED_HEAD: ${{ github.event.pull_request.head.sha }}'));
  assert.ok(workflow.includes('test "$(git rev-parse HEAD)" = "$EXPECTED_HEAD"'));
  const part=workflow.split('  live-http-audit:')[0];
  assert.ok(!part.includes('node .github/scripts/audit-live-playground.mjs'));
});

test('live audit verifies exact checkout and has no write/deploy privileges',()=>{
  for(const forbidden of ['pages: write','id-token: write','actions/deploy-pages@','pull_request_target:','persist-credentials: true'])
    assert.ok(!workflow.includes(forbidden),'unsafe release audit privilege: '+forbidden);
  assert.match(workflow,/permissions:\n\s+contents: read/);
  assert.ok(workflow.includes('EXPECTED_SOURCE_SHA: ${{ github.event_name == \'workflow_run\' && github.event.workflow_run.head_sha || github.sha }}'));
  assert.ok(workflow.includes('ATTO_PUBLIC_COMPILER_SHA256: ${{ vars.ATTO_PUBLIC_COMPILER_SHA256 }}'));
  assert.ok(workflow.includes('git rev-parse HEAD^{tree}'));
});
