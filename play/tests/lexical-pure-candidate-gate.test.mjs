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
  assert.equal(manifest.source_head, 'e48b7d203c870000ca17337aeaa87506928a2ff1');
  assert.equal(manifest.source_tree, '8fb5e66fb6c74dff817112a1847d67fcba6ba51f');
  assert.equal(manifest.source_validated_head, manifest.source_head);
  assert.equal(manifest.carrier_head, '2846237acae466a55c6ed82dc4b5950e5ebfc63e');
  assert.equal(manifest.artifact_id, 14181146814);
  assert.equal(manifest.artifact_zip_sha256, '7942acaf18c7a9f00ab00ca3d3a6f33af4a6270f038fef6ffdc92cff1d6008e4');
  assert.equal(manifest.compiler_sha256, '76eb3cc0699f21d6733956a2a6703f6d17138f669805e371fcb7523f67154d00');
  assert.equal(manifest.compiler_bytes, 502468);
  assert.equal(manifest.compiler_import_count, 0);
  assert.equal(manifest.compiler_abi, 2);
  assert.equal(manifest.guest_abi, 'atto.browser.guest.v2');
  assert.deepEqual(manifest.features, {caller_trap:true, ordinary_throw:true, nested_option_result:true, lexical_pure:true});
  assert.equal(manifest.conformance.passed, 379);
  assert.equal(manifest.conformance.failed, 0);
  assert.equal(manifest.conformance.native_wasm_byte_compares, 342);
  assert.equal(manifest.conformance.chromium_browser, true);
  assert.equal(manifest.conformance.java_differential, false);
  assert.equal(manifest.public_disclosure_approved, false);
  assert.ok(Date.parse(manifest.artifact_expires_at) > Date.parse('2026-11-15T21:13:53Z'));
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
