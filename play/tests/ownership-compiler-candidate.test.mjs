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
 assert.equal(receipt.source_head,'d0995c74fcde4b02cd9a21d8709300ae56a605fe');
 assert.equal(receipt.source_tree,'08bc12967d4947ef5339c486dc647ebb4d0b942a');
 assert.equal(receipt.source_validated_head,receipt.source_head);
 assert.equal(receipt.carrier_head,'c17e4fe5874cbfc2b1c69ccfad6f3166e4c68179');
 assert.equal(receipt.artifact_id,14178412329);
 assert.equal(receipt.compiler_sha256,'934ea08e99849924c82c580cb06a6c31675bc1fe40e6a5743d21a4766d082268');
 assert.equal(receipt.compiler_bytes,501676);
 assert.equal(receipt.compiler_import_count,0);
 assert.equal(receipt.verified_feature_profile,'explicit-ownership-bang-v1');
 assert.deepEqual(receipt.ownership_proof.canonical_syntax,
  ['borrow! owner','borrow! mut owner','copy! value','take! owner','share! value']);
 assert.equal(receipt.ownership_proof.exact_source_blob_count,408);
 assert.equal(receipt.ownership_proof.positive_guest_cases,3);
 assert.equal(receipt.ownership_proof.negative_no_artifact_cases,27);
 assert.deepEqual(receipt.conformance,{passed:389,failed:0,native_wasm_byte_compares:352,
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
