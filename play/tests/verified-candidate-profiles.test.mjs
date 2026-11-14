import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {
  CANDIDATE_NAMES, candidateProfile, verifyCandidate
} from '../tools/verify-compiler-candidate.mjs';

const manifests = await Promise.all(CANDIDATE_NAMES.map(async name => JSON.parse(
  await readFile(new URL('../release-candidates/'+name,import.meta.url),'utf8')
)));
const [legacy,actorTrap,guestTrap] = manifests;
const clone = x => structuredClone(x);

test('all explicitly reviewed receipt formats classify without silently downgrading trap',()=>{
  assert.deepEqual(CANDIDATE_NAMES, [
    '2026-11-13-rust-wasm.json',
    '2026-11-13-rust-wasm-trap.json',
    '2026-11-13-trap-eh-rust-wasm.json'
  ]);
  assert.equal(candidateProfile(legacy),'legacy-no-trap');
  assert.equal(candidateProfile(actorTrap),'typed-ordinary-throw-trap');
  assert.equal(candidateProfile(guestTrap),'typed-ordinary-throw-trap');
});

test('reject ambiguous/forged feature metadata instead of falling back to legacy',()=>{
  for (const value of [null,[],{},'true',1]) {
    // null, arrays, and scalars are malformed; {} is well-formed but has
    // no claim. It must not downgrade an explicitly claimed typed profile.
    const receipt=clone(actorTrap);
    receipt.features=value;
    assert.throws(()=>candidateProfile(receipt),/feature claims|Inconsistent/);
  }
  for(const receipt of [
    {...clone(guestTrap), features:{caller_trap:true, ordinary_throw:false, nested_option_result:true}},
    {...clone(guestTrap), features:{caller_trap:false, ordinary_throw:true}},
    {...clone(guestTrap), features:{caller_trap:true, ordinary_throw:true}},
    {...clone(guestTrap), features:{caller_trap:true, ordinary_throw:true, nested_option_result:true, 'mystery':true}},
    {...clone(guestTrap), verified_feature_profile:'unknown-contract'},
    {...clone(actorTrap), features:{caller_trap:false, ordinary_throw:false, nested_option_result:false}},
    {...clone(actorTrap), features:{caller_trap:true, ordinary_throw:true, nested_option_result:true, extra:null}}
  ]) assert.throws(()=>candidateProfile(receipt),/feature|provenance|downgrade/);
});

test('only reviewed candidate names are accepted before reading any Wasm bytes',async()=>{
  for(const name of [
    '../public/atto_compiler.receipt.json',
    '2026-11-13-unknown.json',
    '2026-11-14-rust-wasm-trap.json',
    '2026-11-13-rust-wasm-trap.json/../x.json',
    'https://evil.invalid/candidate.json',
    null, [], {}, 1
  ]) {
    await assert.rejects(
      verifyCandidate('/missing/atto_compiler.wasm',{candidateName:name}),
      /Unapproved candidate receipt name/
    );
  }
  for(const options of [null,[],3,true]) {
    await assert.rejects(
      verifyCandidate('/missing/atto_compiler.wasm',options),
      /Candidate selector must be/
    );
  }
});

test('all three reviewed candidates pass receipt validation and still require real Wasm bytes',async()=>{
  for(const name of CANDIDATE_NAMES) {
    await assert.rejects(
      verifyCandidate('/missing/atto_compiler.wasm',{candidateName:name}),
      /ENOENT/
    );
  }
});

test('release does not import or publish any private compiler source/artifact',async()=>{
  const pin=JSON.parse(await readFile(
    new URL('../public/atto_compiler.receipt.json',import.meta.url),'utf8'));
  assert.equal(pin.compiler_sha256,'b7c5e86d8b25a67cc1ea3200b08e088c4022b9d9f8599ba7b87b1253f6822860');
  for(const receipt of manifests) {
    assert.equal(receipt.public_disclosure_approved,false);
    assert.notEqual(pin.compiler_sha256,receipt.compiler_sha256);
  }
});
