import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateMetadataSnapshot} from '../tools/validate-metadata.mjs';
const schema=JSON.parse(readFileSync(new URL('../schemas/metadata-snapshot.v1.schema.json',import.meta.url)));
const A='a'.repeat(40),B='b'.repeat(40),D='d'.repeat(64);
const good=()=>{
 const now=new Date().toISOString();
 return {schema:'attolang.metadata-snapshot.v1',mode:'read-only-source-free',collected_at:now,release_certification:'NOT_CERTIFIED',records:[{
  backend:'LLVM',feature:'Checked arithmetic',repository:'example-org/compiler',pr:'42',head_sha:A,tree_sha:B,ci_repository:'example-org/compiler',
  workflow_id:'11',run_id:'22',job_id:'33',run_head_sha:A,run_attempt:'1',job_run_attempt:'1',run_status:'completed',run_conclusion:'success',job_conclusion:'success',
  runner:'ci',runner_os:'ubuntu',runner_type:'',artifact_name:'guest-receipt',artifact_sha256:'sha256:'+D,artifact_expires_at:new Date(Date.now()+86400000).toISOString(),
  contract_id:'checked-i64',contract_version:'v1',contract_result:'not_executed',test_kind:'none',test_result:'not_executed',
  review_state:'approved',reviewer:'reviewer',review_head_sha:A,pr_author:'author',evidence_at:now,notes:'Metadata only; no guest attestation.'
 }]};
};
test('schema rejects extra properties and guest assertions',()=>{
 assert.equal(schema.additionalProperties,false);assert.equal(schema.properties.records.maxItems,1);
 assert.equal(schema.properties.records.items.additionalProperties,false);assert.equal(schema.properties.records.items.properties.test_kind.const,'none');
});
test('direct and exact-tree mirrored metadata are valid',()=>{
 assert.equal(validateMetadataSnapshot(good()).records[0].head_sha,A);
 const r=good();Object.assign(r.records[0],{ci_repository:'example-org/mirror',mirror_repository:'example-org/mirror',mirror_commit_sha:'c'.repeat(40),mirror_tree_sha:B,run_head_sha:'c'.repeat(40)});
 assert.doesNotThrow(()=>validateMetadataSnapshot(r));
});
test('wrong SHA, tree mismatch, incomplete mirror and cross-repo CI fail closed',()=>{
 for(const x of [{head_sha:'bad'},{mirror_commit_sha:'c'.repeat(40)},{ci_repository:'example-org/mirror'},
 {mirror_repository:'example-org/mirror',mirror_commit_sha:'c'.repeat(40),mirror_tree_sha:'f'.repeat(40),ci_repository:'example-org/mirror',run_head_sha:'c'.repeat(40)}]){
  const r=good();Object.assign(r.records[0],x);
  assert.throws(()=>validateMetadataSnapshot(r),/Invalid metadata snapshot/);
 }
});
test('metadata cannot become guest proof or release certification',()=>{
 for(const x of [{test_kind:'guest'},{test_result:'passed'},{contract_result:'passed'}]){
  const r=good();Object.assign(r.records[0],x);assert.throws(()=>validateMetadataSnapshot(r),/cannot promote/);
 }
 const r=good();r.release_certification='CERTIFIED';assert.throws(()=>validateMetadataSnapshot(r),/root/);
});
test('credentials, unknown fields and incomplete records fail closed',()=>{
 for(const x of [{Authorization:'secret'}, {guest_passed:true}, {artifact_sha256:'bad'}]){
  const r=good();Object.assign(r.records[0],x);assert.throws(()=>validateMetadataSnapshot(r),/Invalid/);
 }
 const r=good();delete r.records[0].head_sha;assert.throws(()=>validateMetadataSnapshot(r),/head_sha/);
});
test('self approval, wrong-head approval and malformed time fail closed',()=>{
 for(const x of [{reviewer:'author'},{review_head_sha:'f'.repeat(40)},{evidence_at:'NaN'}]){
  const r=good();Object.assign(r.records[0],x);assert.throws(()=>validateMetadataSnapshot(r),/Invalid/);
 }
});
