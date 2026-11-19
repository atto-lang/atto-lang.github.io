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
  assert.equal(manifest.source_head, 'ae442e00850a6c392d0767b16942e0d8b7fbe636');
  assert.equal(manifest.source_tree, 'abb4d53742d8c38f348f74246edc1c6e3ffce69d');
  assert.equal(manifest.source_validated_head, manifest.source_head);
  assert.equal(manifest.carrier_head, 'b30af8c07de8087b111185e6505717fed915f65b');
  assert.equal(manifest.artifact_id, 14182971690);
  assert.equal(manifest.artifact_zip_sha256, '315140badcd51c3c90056cd9bfe9447cf7bb2dc577f1ffc68e1091b6597ccc9c');
  assert.equal(manifest.compiler_sha256, '32a7a0021cf52453ed3161e3a020661076d047a4d44fb8c0c48066fef0028938');
  assert.equal(manifest.compiler_bytes, 516282);
  assert.equal(manifest.compiler_import_count, 0);
  assert.equal(manifest.compiler_abi, 2);
  assert.equal(manifest.guest_abi, 'atto.browser.guest.v2');
  assert.deepEqual(manifest.features, {caller_trap:true, ordinary_throw:true, nested_option_result:true, lexical_pure:true});
  assert.equal(manifest.conformance.passed, 381);
  assert.equal(manifest.conformance.failed, 0);
  assert.equal(manifest.conformance.native_wasm_byte_compares, 344);
  assert.equal(manifest.conformance.chromium_browser, true);
  assert.equal(manifest.conformance.reproducible_clean_target, true);
  assert.equal(manifest.conformance.actor_trace_passed, 28);
  assert.equal(manifest.conformance.required_compiler_exports_verified, true);
  assert.equal(manifest.carrier_run, 'https://github.com/streempilot-test/browser-studio-e2e/actions/runs/43767355471');
  assert.equal(manifest.conformance.java_differential, false);
  assert.equal(manifest.public_disclosure_approved, false);
  assert.equal(manifest.artifact_expires_at, '2026-11-22T22:07:14Z');
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

test('lexical scope preview runs on the reviewed public binary', async () => {
  const [sample, app, docs] = await Promise.all([
    readFile(new URL('../examples/preview/lexical-scope-pure.atto', import.meta.url), 'utf8'),
    readFile(new URL('../src/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../docs/COMPILER_CONTRACT.md', import.meta.url), 'utf8'),
  ]);
  assert.match(sample, /^\/\/ LANGUAGE PREVIEW — compiles and runs in this browser playground\./);
  assert.match(sample, /Expected output: 42, 42, 2, 42\./);
  assert.match(app, /const EXECUTABLE_PREVIEWS = new Set\([^\n]*"preview\/lexical-scope-pure"/);
  assert.match(docs, /Preview Format remains disabled/);
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
  assert.match(sample, /Java\/LLVM parity is not claimed/);
  assert.doesNotMatch(sample, /PRIVATE Rust\/Wasm compiler candidate/);
  assert.match(sample, /compiler statically rejects I\/O, shared state and impure call chains/);
  assert.match(docs, /Java\/GraalVM/);
  assert.match(docs, /escaping lambdas with mutable/);
  assert.match(docs, /LLVM effect-bit utility/);
  assert.match(docs, /not.*proof that the LLVM frontend executes/);
  assert.match(docs, /pure fnc.*spelling/);
  assert.match(docs, /Preview Format remains disabled/);
});


test('lexical candidate verifier includes executable constructor capture and fail-closed escape', async () => {
  const source = await readFile(new URL('../tools/verify-compiler-candidate.mjs', import.meta.url), 'utf8');
  assert.match(source, /lexical-constructor-definition-site-capture/);
  assert.match(source, /new Container\(transform\(21\)\)/);
  assert.match(source, /constructor-argument-first-class-lambda-escape-forbidden/);
  assert.match(source, /new Holder\(direct\)/);
  assert.match(source, /Number\.isSafeInteger\(receipt\.conformance\?\.passed\)/);
  assert.match(source, /requiredExports\.some\(name => !actualExports\.has\(name\)\)/);
});
