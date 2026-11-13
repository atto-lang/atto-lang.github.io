import test from 'node:test';
import assert from 'node:assert/strict';
import {collect} from '../tools/collect-readonly.mjs';
const A='a'.repeat(40),B='b'.repeat(40),C='c'.repeat(40),D='d'.repeat(64);
const opts={repo:'example-org/compiler',pr:'42',backend:'LLVM',feature:'Checked arithmetic',workflow:'11',run:'22',job:'33',artifact:'guest-receipt',contract:'checked-i64',version:'v1',out:'/tmp/attolang-test-only.json'};
function mock(change={}){
 const calls=[];let prReads=0,runReads=0;
 const expires=new Date(Date.now()+86400000).toISOString();
 const responses={
  '/repos/example-org/compiler/pulls/42':()=>({head:{sha:++prReads>1&&change.moved?C:A},user:{login:'author'}}),
  ['/repos/example-org/compiler/git/commits/'+A]:()=>({tree:{sha:B}}),
  '/repos/example-org/compiler/actions/runs/22':()=>({id:22,workflow_id:11,head_sha:change.runHead||A,run_attempt:change.rerun&&++runReads>1?2:1,status:'completed',conclusion:change.runConclusion||'success',updated_at:change.stale?'2025-01-01T00:00:00Z':new Date().toISOString(),repository:{full_name:'example-org/compiler'}}),
  '/repos/example-org/compiler/actions/jobs/33':()=>({id:33,run_id:22,run_attempt:change.jobAttempt||1,runner_name:change.noRunner?'':'trusted-runner',labels:['ubuntu-24.04'],conclusion:change.jobConclusion||'success'}),
  '/repos/example-org/compiler/pulls/42/reviews?per_page=100&page=1':()=>[{state:'APPROVED',user:{login:change.reviewer||'independent'},commit_id:change.reviewHead||A}],
  '/repos/example-org/compiler/actions/runs/22/artifacts?per_page=100&page=1':()=>{
   const artifacts=change.artifacts??[{name:'guest-receipt',digest:'sha256:'+D,expired:false,expires_at:expires,workflow_run:{id:22}}];
   return {total_count:change.badPagination?artifacts.length+1:artifacts.length,artifacts};
  }
 };
 if(change.mirror){
  responses['/repos/example-org/mirror/git/commits/'+C]=()=>({tree:{sha:change.mismatch?'f'.repeat(40):B}});
  responses['/repos/example-org/mirror/actions/runs/22']=()=>({id:22,workflow_id:11,head_sha:C,run_attempt:1,status:'completed',conclusion:'success',updated_at:new Date().toISOString(),repository:{full_name:'example-org/mirror'}});
  responses['/repos/example-org/mirror/actions/jobs/33']=responses['/repos/example-org/compiler/actions/jobs/33'];
  responses['/repos/example-org/mirror/actions/runs/22/artifacts?per_page=100&page=1']=responses['/repos/example-org/compiler/actions/runs/22/artifacts?per_page=100&page=1'];
 }
 const fetchFn=async (url,init)=>{
  calls.push(url);assert.equal(init.method,'GET');assert.equal(init.credentials,'omit');assert.equal(init.redirect,'error');
  assert.ok(url.startsWith('https://api.github.com/repos/'));
  const v=responses[url.replace('https://api.github.com','')]?.();
  return v?{ok:true,headers:{get:()=>null},text:async()=>JSON.stringify(v)}:{ok:false,status:404,headers:{get:()=>null},text:async()=>'{}'};
 };
 return {calls,fetchFn};
}
test('snapshot is advisory and makes eight GET calls without source downloads',async()=>{
 const m=mock(),r=await collect(opts,{fetchFn:m.fetchFn});
 assert.equal(m.calls.length,8);assert.ok(m.calls.every(x=>!/contents|logs|download/.test(x)));
 assert.equal(r.schema,'attolang.metadata-snapshot.v1');assert.equal(r.release_certification,'NOT_CERTIFIED');
 assert.equal(r.records[0].test_kind,'none');assert.equal(r.records[0].contract_result,'not_executed');
 assert.equal(r.records[0].review_state,'approved');assert.equal(r.records[0].tree_sha,B);
});
test('moving PR head and rerunning CI during collection fail closed',async()=>{
 await assert.rejects(()=>collect(opts,{fetchFn:mock({moved:true}).fetchFn}),/head moved/);
 await assert.rejects(()=>collect(opts,{fetchFn:mock({rerun:true}).fetchFn}),/CI run changed/);
});
test('wrong run head, attempt, failed CI and stale CI fail closed',async()=>{
 for(const c of [{runHead:C},{jobAttempt:2},{runConclusion:'failure'},{jobConclusion:'failure'},{stale:true},{noRunner:true}])
  await assert.rejects(()=>collect(opts,{fetchFn:mock(c).fetchFn}),/Run head|attempt mismatch|not successful|stale|Runner provenance/);
});
test('missing artifact, bad SHA, expiration, pagination and wrong workflow binding fail closed',async()=>{
 for(const c of [
  {artifacts:[]},{badPagination:true},{artifacts:[{name:'guest-receipt',digest:'invalid',expired:false}]},
  {artifacts:[{name:'guest-receipt',digest:'sha256:'+D,expired:false,expires_at:'2020-01-01T00:00:00Z',workflow_run:{id:22}}]},
  {artifacts:[{name:'guest-receipt',digest:'sha256:'+D,expired:false,expires_at:new Date(Date.now()+86400000).toISOString(),workflow_run:{id:123}}]}
 ])await assert.rejects(()=>collect(opts,{fetchFn:mock(c).fetchFn}),/Artifact|artifact|Exactly one/);
});
test('independent approvals only and no token in output',async()=>{
 const a=await collect(opts,{fetchFn:mock({reviewer:'author'}).fetchFn,token:'SYNTHETIC_SECRET'});
 assert.equal(a.records[0].review_state,'pending');
 assert.doesNotMatch(JSON.stringify(a),/SYNTHETIC_SECRET/);
});
test('exact-tree mirror allowed but incorrect mirror tree rejected',async()=>{
 const optsMirror={...opts,'ci-repo':'example-org/mirror','mirror-repo':'example-org/mirror','mirror-commit':C};
 const r=await collect(optsMirror,{fetchFn:mock({mirror:true}).fetchFn});
 assert.equal(r.records[0].mirror_tree_sha,B);
 await assert.rejects(()=>collect(optsMirror,{fetchFn:mock({mirror:true,mismatch:true}).fetchFn}),/tree mismatch/);
});
test('invalid inputs rejected before any network request',async()=>{
 const m=mock();
 for(const extra of [{repo:'example-org/compiler/../private'},{backend:'Other'}, {'mirror-commit':C},{out:'-'},{'unknown':'bad'}])
  await assert.rejects(()=>collect({...opts,...extra},{fetchFn:m.fetchFn}),/Invalid|Unsupported|Mirror|Unknown|explicit/);
 assert.equal(m.calls.length,0);
});
