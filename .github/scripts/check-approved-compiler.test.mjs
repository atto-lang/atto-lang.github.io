import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {verifyApprovedCompiler, COMPILER_FILE} from './check-approved-compiler.mjs';

const compilerBytes = await readFile(COMPILER_FILE);
const DIGEST = createHash('sha256').update(compilerBytes).digest('hex');
const valid = {
  reviewedSha: DIGEST, requestedSha: DIGEST, confirmed: 'yes',
  event: 'workflow_dispatch', ref: 'refs/heads/main',
  repository: 'atto-lang/atto-lang.github.io', compilerBytes
};
test('explicitly reviewed digest authorizes exact compiler bytes only on manual main',()=>{
  const receipt = verifyApprovedCompiler(valid);
  assert.deepEqual(receipt, {verified:true,compiler_sha256:DIGEST,bytes:compilerBytes.length});
});
test('missing, false, stale or malformed independent approval always blocks',()=>{
  for(const changes of [
    {reviewedSha:undefined},{reviewedSha:''},
    {reviewedSha:'f'.repeat(64)},{reviewedSha:DIGEST.toUpperCase()},
    {requestedSha:'f'.repeat(64)},{requestedSha:''},
    {requestedSha:undefined},{requestedSha:'a'.repeat(63)},
    {reviewedSha:'f'.repeat(64),requestedSha:'f'.repeat(64)}
  ]) {
    assert.throws(()=>verifyApprovedCompiler({...valid,...changes}),/Blocked/);
  }
});
test('revocation or change between build and deployment must fail',()=>{
  // Simulates the independently administered digest changing while an
  // already tested and uploaded artifact waits for environment approval.
  assert.equal(verifyApprovedCompiler(valid).verified,true);
  assert.throws(()=>verifyApprovedCompiler({...valid,reviewedSha:'0'.repeat(64)}),/Blocked/);
  assert.throws(()=>verifyApprovedCompiler({...valid,requestedSha:'0'.repeat(64)}),/Blocked/);
});
test('only true confirmed workflow_dispatch to public main is authorized',()=>{
  for(const changes of [
    {event:'pull_request'},{event:'push'},{event:undefined},
    {ref:'refs/heads/feature'},{ref:'refs/tags/v1'},
    {repository:'attacker/atto-lang.github.io'},
    {confirmed:'no'},{confirmed:'true'}, {confirmed:undefined}
  ]) assert.throws(()=>verifyApprovedCompiler({...valid,...changes}),/Blocked/);
});
test('tampered, empty, truncated and oversized compiler artifacts block',()=>{
  const altered = Buffer.from(compilerBytes);
  altered[altered.length-1]^=1;
  for(const bytes of [altered,Buffer.alloc(0),Buffer.alloc(3),Buffer.alloc(1024*1024+1)]) {
    assert.throws(()=>verifyApprovedCompiler({...valid,compilerBytes:bytes}),/Blocked/);
  }
});
test('release workflow invokes the same independently reviewed verifier in both jobs',async()=>{
  const workflow=await readFile(new URL('../workflows/approved-playground-pages.yml',import.meta.url),'utf8');
  const checks=workflow.match(/node \.github\/scripts\/check-approved-compiler\.mjs/g)||[];
  assert.equal(checks.length,2,'recheck both after verification and after environment admission');
  const idx0=workflow.indexOf('Enforce independently approved public compiler digest on deploy');
  const idx1=workflow.indexOf('Recheck active main release gates immediately before deploy');
  const idx2=workflow.indexOf('Recheck compiler approval after protected environment admission');
  const idx3=workflow.indexOf('uses: actions/deploy-pages@');
  assert.ok(idx0>=0 && idx1>idx0 && idx2>idx1 && idx3>idx2);
  const deployPart=workflow.slice(idx1,idx3);
  for(const variable of [
    'REVIEWED_SHA:', 'REQUESTED_SHA:', 'CONFIRMED:',
    'ATTO_PUBLIC_COMPILER_SHA256','approved_compiler_sha256'
  ]) assert.ok(deployPart.includes(variable),'missing final deploy approval: '+variable);
});


// Execute the exact shell guard embedded in the production workflow rather
// than duplicating its predicate in a test-only implementation.
test('manual release preflight rejects placeholders, wrong digests and unconfirmed dispatches before build',async()=>{
  const workflow=await readFile(new URL('../workflows/approved-playground-pages.yml',import.meta.url),'utf8');
  const start=workflow.indexOf('  validate-dispatch:\n');
  const end=workflow.indexOf('  verify-public-artifact:\n',start);
  const expensive=workflow.indexOf('Require exact source SHA and execute release-package tests');
  assert.ok(start>=0 && end>start && expensive>end,'input preflight must precede release tests');
  const stage=workflow.slice(start,end);
  assert.match(stage,/permissions: \{\}/,'preflight has no GitHub token permissions');
  assert.match(workflow,/  verify-public-artifact:\n    needs: validate-dispatch/);
  assert.match(workflow,/Paste approved 64-character SHA-256 value \(not the input name\)/);
  const lines=stage.split('\n');
  const at=lines.indexOf('        run: |');
  assert.ok(at>=0,'preflight must execute a shell guard');
  const shell=lines.slice(at+1).filter(line=>line.startsWith('          '))
    .map(line=>line.slice(10)).join('\n');
  assert.ok(shell.includes('set -euo pipefail'));
  const env={...process.env, EVENT_NAME:'workflow_dispatch',
    RELEASE_REF:'refs/heads/main',RELEASE_REPO:'atto-lang/atto-lang.github.io',
    CONFIRMED:'yes',REVIEWED_SHA:DIGEST,REQUESTED_SHA:DIGEST};
  const exec=changes=>spawnSync('bash',['-c',shell],{env:{...env,...changes},encoding:'utf8'});
  const good=exec({});
  assert.equal(good.status,0,good.stderr);
  assert.match(good.stdout,/PASS manual main release digest input/);
  const bad=[
    {REQUESTED_SHA:'approved_compiler_sha256'},
    {REQUESTED_SHA:''}, {REQUESTED_SHA:DIGEST.toUpperCase()},
    {REQUESTED_SHA:'0'.repeat(64)}, {REQUESTED_SHA:DIGEST+'x'},
    {REVIEWED_SHA:''}, {REVIEWED_SHA:'x'.repeat(64)},
    {CONFIRMED:'no'}, {CONFIRMED:''},
    {EVENT_NAME:'push'}, {RELEASE_REF:'refs/heads/feature'},
    {RELEASE_REPO:'attacker/atto-lang.github.io'}
  ];
  for(const [i,change] of bad.entries()){
    const result=exec(change);
    assert.notEqual(result.status,0,'invalid manual input case '+i);
  }
  // The current compiler must still be checked again after PR provenance and
  // once more immediately before deploy; input screening never substitutes
  // for the actual compiler byte attestation.
  assert.equal((workflow.match(/node \.github\/scripts\/check-approved-compiler\.mjs/g)||[]).length,2);
});
