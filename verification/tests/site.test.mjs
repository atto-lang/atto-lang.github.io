import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(x=>x[1]);
const csp=html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/i)?.[1]||'';
const context={module:{exports:{}}};
vm.runInNewContext(scripts[0],context,{timeout:1000});
const E=context.module.exports;
const sha=c=>c.repeat(40);
function fixture(x={}){
 const now=new Date().toISOString();
 return E.normalizeRecord({repository:'example-org/synthetic',pr:21,backend:'LLVM',feature:'Checked arithmetic',
  head_sha:sha('a'),checked_head_sha:sha('a'),commit_sha:sha('a'),tree_sha:sha('b'),run_head_sha:sha('a'),
  workflow_id:'100',run_id:'101',job_id:'102',github_verified_run_id:'101',
  github_verified_head_sha:sha('a'),github_verified_tree_sha:sha('b'),github_checked_at:now,
  run_status:'completed',run_conclusion:'success',job_conclusion:'success',
  run_attempt:'1',job_run_attempt:'1',runner:'test-runner',runner_os:'ubuntu',runner_type:'hosted',
  artifact_name:'example-artifact',artifact_sha256:'c'.repeat(64),artifact_observed_sha256:'c'.repeat(64),
  receipt_sha256:'d'.repeat(64),provenance:'verified',test_kind:'guest',test_result:'passed',
  contract_id:'checked-arithmetic-v1',contract_version:'1.0.0',contract_result:'passed',
  review_state:'approved',reviewer:'independent',pr_author:'author',review_head_sha:sha('a'),
  evidence_at:now,...x});
}
test('no remote script or remote stylesheet',()=>{assert.equal(scripts.length,2);assert.doesNotMatch(html,/<script\b[^>]*\bsrc=/i);assert.doesNotMatch(html,/<link\b[^>]*\brel="stylesheet"/i)});
test('CSP denies remote code except GitHub metadata GET',()=>{
 assert.match(csp,/default-src 'none'/);assert.match(csp,/object-src 'none'/);assert.match(csp,/form-action 'none'/);
 const expected=scripts.map(s=>createHash('sha256').update(s).digest('base64')).sort();
 const found=[...csp.matchAll(/'sha256-([^']+)'/g)].map(x=>x[1]).sort();assert.deepEqual(found,expected);
});
test('no network writes or credentials',()=>{
 const matches=[...scripts[1].matchAll(/\bfetch\s*\(([^;]+)\);/g)];
 assert.equal(matches.length,1);assert.match(matches[0][1],/https:\/\/api\.github\.com/);
 assert.match(matches[0][1],/method:'GET'/);assert.match(matches[0][1],/credentials:'omit'/);
 assert.doesNotMatch(scripts.join('\n'),/\bXMLHttpRequest\b|\bsendBeacon\b|\bWebSocket\b/);
});
test('demo and host-only cannot satisfy guest gate',()=>{
 assert.equal(E.assess(fixture({demo:true})).mergeReady,false);
 assert.equal(E.status(fixture({test_kind:'host'})),'HOST_ONLY');
 assert.equal(E.status(fixture({test_kind:'parser'})),'PARSER_ONLY');
 assert.equal(E.status(fixture({test_kind:'none',test_result:'not_executed'})),'NOT_EXECUTED');
});
test('stale, retargeted, and mirror-mismatched execution fails closed',()=>{
 for(const x of [{github_verified_head_sha:sha('e')},{run_head_sha:sha('e')},
  {mirror_repository:'mirror-org/example',mirror_commit_sha:sha('e'),mirror_tree_sha:sha('f')},
  {receipt_sha256:''},{evidence_at:'2025-01-01T00:00:00Z'}])
   assert.equal(E.assess(fixture(x)).mergeReady,false,JSON.stringify(x));
});
test('self-review is not independent and browser cannot certify',()=>{
 assert.equal(E.assess(fixture({reviewer:'author'})).mergeReady,false);
 assert.equal(E.assess(fixture()).releaseCertified,false);
 assert.match(E.report([fixture()]),/NOT_CERTIFIED/);
});
test('duplicate contract and divergent versions reject parity',()=>{
 const records=E.BACKENDS.map(backend=>fixture({backend}));
 assert.equal(E.parity(records).fullyAligned,1);
 assert.equal(E.parity([...records,fixture()]).fullyAligned,0);
 assert.equal(E.parity(records.map((r,i)=>i===2?{...r,contract_version:'other'}:r)).fullyAligned,0);
});
test('no private source repository IDs embedded',()=>{
 assert.doesNotMatch(html,/atto-lang\/atto-source\.|ores-truffle-oreslang\/oreslang-source/i);
 assert.match(html,/example-org/);
});
