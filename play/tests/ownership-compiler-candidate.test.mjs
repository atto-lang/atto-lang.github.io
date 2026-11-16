import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {ASSETS, PUBLICATION_ASSETS} from '../../.github/scripts/package-playground.mjs';
import {CANDIDATE_NAMES, candidateProfile, verifyCandidate} from '../tools/verify-compiler-candidate.mjs';

const name='2026-11-15-ownership-rust-wasm.json';
const receipt=JSON.parse(await readFile(new URL('../release-candidates/'+name,import.meta.url),'utf8'));
const published=JSON.parse(await readFile(new URL('../public/atto_compiler.receipt.json',import.meta.url),'utf8'));

test('ownership candidate is private, source-tree verified and intentionally unapproved',()=>{
 assert.equal(receipt.schema,'atto.browser.compiler.candidate.v1');
 assert.equal(receipt.status,'verified_candidate_unpublished');
 assert.equal(receipt.public_disclosure_approved,false);
 assert.equal(receipt.source_repository,'atto-lang/atto-source.rs');
 assert.equal(receipt.source_head,'0082d26e93485b5395ce805d61e655d1cc46ea40');
 assert.equal(receipt.source_tree,'0c876390fc6ae30aa553d237196775f78cfccbc8');
 assert.equal(receipt.source_validated_head,receipt.source_head);
 assert.equal(receipt.carrier_head,'33d44b2cbd6e54a9e634bcb0664b8b509b86360b');
 assert.equal(receipt.artifact_id,14180461430);
 assert.equal(receipt.compiler_sha256,'607eb2cbe69065e9379d95b1600c45e3e3179ffe28fdecbe3f6ac5199c6c0bc3');
 assert.equal(receipt.compiler_bytes,501769);
 assert.equal(receipt.compiler_import_count,0);
 assert.equal(receipt.verified_feature_profile,'explicit-ownership-bang-v1');
 assert.deepEqual(receipt.ownership_proof.canonical_syntax,
  ['borrow! owner','borrow! mut owner','copy! value','take! owner','share! value']);
 assert.equal(receipt.ownership_proof.exact_source_blob_count,417);
 assert.equal(receipt.ownership_proof.positive_guest_cases,5);
 assert.equal(receipt.ownership_proof.negative_no_artifact_cases,34);
 assert.deepEqual(receipt.conformance,{passed:398,failed:0,native_wasm_byte_compares:361,
  chromium_browser:true,java_differential:false});
 assert.equal(candidateProfile(receipt),'explicit-ownership-bang-v1');
});

test('ownership metadata is not a binary publication or a digest-pin update',()=>{
 assert.notEqual(receipt.compiler_sha256,published.compiler_sha256);
 assert.notEqual(receipt.source_head,published.source_head);
 assert.ok(!ASSETS.some(x=>x.startsWith('release-candidates/')));
 assert.ok(!PUBLICATION_ASSETS.some(x=>x.includes('release-candidates')));
 assert.ok(!PUBLICATION_ASSETS.includes('play/release-candidates/'+name));
});

test('ownership read-only verifier requires exact allowed receipt path and non-leaked wasm',async()=>{
 assert.ok(CANDIDATE_NAMES.includes(name));
 await assert.rejects(verifyCandidate('test.wasm',{candidateName:'../../'+name}),
   /Unapproved candidate receipt name/);
 await assert.rejects(verifyCandidate('/does-not-exist/atto_compiler.wasm',{candidateName:name}),
   /ENOENT/);
});

test('ownership feature profile cannot spoof trap support or arbitrary features',()=>{
 assert.throws(()=>candidateProfile({...receipt,verified_feature_profile:'unsupported-ownership'}),/Unknown compiler feature profile/);
 assert.throws(()=>candidateProfile({...receipt,features:{caller_trap:true,ordinary_throw:true,nested_option_result:true}}),
   /Ownership candidate must not claim unverified trap features/);
});
