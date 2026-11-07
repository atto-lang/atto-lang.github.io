import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
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
