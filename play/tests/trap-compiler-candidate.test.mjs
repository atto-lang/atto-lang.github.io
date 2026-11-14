import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {ASSETS, PUBLICATION_ASSETS} from '../../.github/scripts/package-playground.mjs';
import {verifyCandidate} from '../tools/verify-compiler-candidate.mjs';

// No public compiler bytes are written by these tests: these assertions
// concern only release candidate metadata and verifier access boundaries.
const candidate = JSON.parse(await readFile(
  new URL('../release-candidates/2026-11-13-trap-eh-rust-wasm.json', import.meta.url),'utf8'));
const pinned = JSON.parse(await readFile(
  new URL('../public/atto_compiler.receipt.json', import.meta.url),'utf8'));

test('trap compiler has source-tree-identical provenance from executed CI',()=>{
  assert.equal(candidate.schema,'atto.browser.compiler.candidate.v1');
  assert.equal(candidate.status,'verified_candidate_unpublished');
  assert.equal(candidate.public_disclosure_approved,false);
  assert.equal(candidate.source_repository,'atto-lang/atto-source.rs');
  assert.equal(candidate.source_head,'7f7c034544f206e715b509f6ba088b2c647a570d');
  assert.equal(candidate.source_tree,'cf8e32841e6ae2dfce9b071a0016d4fea56f7db6');
  assert.equal(candidate.source_validated_head,'2974b2789659c7c4677990a80bc98e37346f6b89');
  assert.equal(candidate.carrier_head,'387369c96eae4a34399c98bd837a7e3f3452aed6');
  assert.equal(candidate.artifact_id,14067141273);
  assert.equal(candidate.compiler_sha256,'f872f764419002e0f27e2a773c7bb0bf60c71692e49b13d8015e379a62d2549c');
  assert.equal(candidate.compiler_bytes,337443);
  assert.equal(candidate.compiler_import_count,0);
  assert.equal(candidate.compiler_abi,2);
  assert.equal(candidate.guest_abi,'atto.browser.guest.v2');
  assert.deepEqual(candidate.features,{caller_trap:true,ordinary_throw:true,nested_option_result:true});
  assert.equal(candidate.conformance.failed,0);
  assert.equal(candidate.conformance.java_differential,false);
});

test('stage is not a binary publish or a silent compiler-pin change',()=>{
  assert.notEqual(candidate.compiler_sha256,pinned.compiler_sha256);
  assert.notEqual(candidate.source_head,pinned.source_head);
  assert.equal(pinned.compiler_sha256,'b7c5e86d8b25a67cc1ea3200b08e088c4022b9d9f8599ba7b87b1253f6822860');
  assert.ok(!ASSETS.some(x=>x.startsWith('release-candidates/')));
  assert.ok(!PUBLICATION_ASSETS.some(x=>x.includes('release-candidates')));
  assert.ok(!PUBLICATION_ASSETS.includes('play/release-candidates/2026-11-13-trap-eh-rust-wasm.json'));
});

test('candidate verifier refuses arbitrary receipt paths before touching compiler bytes',async()=>{
  for (const candidateName of [
    '../public/atto_compiler.receipt.json', '/tmp/artifact.json',
    'https://example.org/receipt.json', 'release-candidates/foo.json',
    '2026-11-13-trap-eh-rust-wasm.json/../foo.json',
    '2026-11-13-trap-eh-rust-wasm.txt'
  ]) {
    await assert.rejects(
      verifyCandidate('test.wasm',{candidateName}),
      /Unapproved candidate receipt name/
    );
  }
});

test('current candidate receipt is accepted by the path gate, but still requires actual Wasm',async()=>{
  await assert.rejects(
    verifyCandidate('/does-not-exist/atto_compiler.wasm',
      {candidateName:'2026-11-13-trap-eh-rust-wasm.json'}),
    /ENOENT/
  );
});
