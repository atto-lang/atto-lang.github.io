import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {CANDIDATE_NAMES, candidateProfile, verifyCandidate, admitCandidateGuestWasm} from '../tools/verify-compiler-candidate.mjs';
import {ASSETS, PUBLICATION_ASSETS} from '../../.github/scripts/package-playground.mjs';

const candidateName = '2026-11-15-lexical-pure-rust-wasm.json';
const manifest = JSON.parse(await readFile(new URL('../release-candidates/'+candidateName, import.meta.url), 'utf8'));
const pinned = JSON.parse(await readFile(new URL('../public/atto_compiler.receipt.json', import.meta.url), 'utf8'));

test('lexical/pure candidate is exact-source, complete, unpublished and expiring', () => {
  assert.equal(candidateProfile(manifest), 'typed-ordinary-throw-trap');
  assert.ok(CANDIDATE_NAMES.includes(candidateName));
  assert.equal(manifest.schema, 'atto.browser.compiler.candidate.v1');
  assert.equal(manifest.source_head, '07a64875df2f9fb2070da4940410a735f27b5c32');
  assert.equal(manifest.source_tree, 'bae535547b4bf0c08a7a72ef09f586b5f625ef8e');
  assert.equal(manifest.source_validated_head, manifest.source_head);
  assert.equal(manifest.carrier_head, '23400776e05a4a786272d7865d4ce29fe0af4e3a');
  assert.equal(manifest.artifact_id, 14179559128);
  assert.equal(manifest.artifact_zip_sha256, '6e1a78945358a5ef15ff539b1f5c07b7773d3fd7e219b203d318ca8aa89ad9df');
  assert.equal(manifest.compiler_sha256, '74f36256ac16c25c6e009eb8b6f335ca6df66a20f42031af2a7bbbb05c6c297d');
  assert.equal(manifest.compiler_bytes, 502451);
  assert.equal(manifest.compiler_import_count, 0);
  assert.equal(manifest.compiler_abi, 2);
  assert.equal(manifest.guest_abi, 'atto.browser.guest.v2');
  assert.deepEqual(manifest.features, {caller_trap:true, ordinary_throw:true, nested_option_result:true, lexical_pure:true});
  assert.equal(manifest.conformance.passed, 377);
  assert.equal(manifest.conformance.failed, 0);
  assert.equal(manifest.conformance.native_wasm_byte_compares, 340);
  assert.equal(manifest.conformance.chromium_browser, true);
  assert.equal(manifest.conformance.java_differential, false);
  assert.equal(manifest.public_disclosure_approved, false);
  assert.ok(Date.parse(manifest.artifact_expires_at) > Date.parse('2026-11-15T20:49:51Z'));
});

test('candidate metadata cannot replace the approved public compiler binary', () => {
  assert.notEqual(manifest.compiler_sha256, pinned.compiler_sha256);
  assert.notEqual(manifest.source_head, pinned.source_head);
  assert.ok(!ASSETS.some(x => x.startsWith('release-candidates/')));
  assert.ok(!PUBLICATION_ASSETS.some(x => x.includes('release-candidates')));
  assert.ok(!ASSETS.some(x => x.includes('private-candidate-receipt')));
});

test('candidate verifier requires actual independently downloaded Wasm bytes', async () => {
  await assert.rejects(
    verifyCandidate('/missing/atto_compiler.wasm', {candidateName}),
    /ENOENT/
  );
  await assert.rejects(
    verifyCandidate('/missing/atto_compiler.wasm', {candidateName:'../'+candidateName}),
    /Unapproved candidate receipt name/
  );
});

test('verified dropdown is kept preview-only until the public binary is approved', async () => {
  const [sample, app, docs] = await Promise.all([
    readFile(new URL('../examples/preview/lexical-scope-pure.atto', import.meta.url), 'utf8'),
    readFile(new URL('../src/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../docs/COMPILER_CONTRACT.md', import.meta.url), 'utf8'),
  ]);
  assert.match(sample, /^\/\/ SYNTAX PREVIEW/);
  assert.match(app, /preview\/lexical-scope-pure/);
  assert.match(docs, /Preview Run and Format remain disabled/);
});

test('private candidate guests use the production memory-admission boundary', () => {
  assert.throws(() => admitCandidateGuestWasm(new Uint8Array()), /E_GUEST_ADMISSION/);
  // Minimal valid Wasm header with no imports or memory is admissible.
  assert.deepEqual(admitCandidateGuestWasm(new Uint8Array([0,97,115,109,1,0,0,0])),
    {memoryCount:0,maxPages:16});
  // One unbounded memory declaration is forbidden even if core Wasm accepts it.
  const unbounded = new Uint8Array([0,97,115,109,1,0,0,0,5,3,1,0,1]);
  assert.throws(() => admitCandidateGuestWasm(unbounded), /E_ACTOR_MEMORY/);
});


test('preview and cross-backend reference contract do not overclaim shipped Wasm or Java/LLVM parity', async () => {
  const [sample, docs] = await Promise.all([
    readFile(new URL('../examples/preview/lexical-scope-pure.atto', import.meta.url), 'utf8'),
    readFile(new URL('../docs/COMPILER_CONTRACT.md', import.meta.url), 'utf8')
  ]);
  assert.match(sample, /SYNTAX PREVIEW.*PUBLIC pinned browser compiler/);
  assert.match(sample, /PRIVATE Rust\/Wasm compiler candidate executes/);
  assert.match(sample, /candidate statically rejects I\/O, shared state and impure call chains/);
  assert.match(docs, /Java\/GraalVM/);
  assert.match(docs, /escaping lambdas with mutable/);
  assert.match(docs, /LLVM effect-bit utility/);
  assert.match(docs, /not.*proof that the LLVM frontend executes/);
  assert.match(docs, /pure fnc.*spelling/);
  assert.match(docs, /Preview Run and Format remain disabled/);
});
