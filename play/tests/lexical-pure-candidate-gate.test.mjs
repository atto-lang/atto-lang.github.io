import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {CANDIDATE_NAMES, candidateProfile, verifyCandidate} from '../tools/verify-compiler-candidate.mjs';
import {ASSETS, PUBLICATION_ASSETS} from '../../.github/scripts/package-playground.mjs';

const candidateName = '2026-11-15-lexical-pure-rust-wasm.json';
const manifest = JSON.parse(await readFile(new URL('../release-candidates/'+candidateName, import.meta.url), 'utf8'));
const pinned = JSON.parse(await readFile(new URL('../public/atto_compiler.receipt.json', import.meta.url), 'utf8'));

test('lexical/pure candidate is exact-source, complete, unpublished and expiring', () => {
  assert.equal(candidateProfile(manifest), 'typed-ordinary-throw-trap');
  assert.ok(CANDIDATE_NAMES.includes(candidateName));
  assert.equal(manifest.schema, 'atto.browser.compiler.candidate.v1');
  assert.equal(manifest.source_head, 'dc250cdbd8a4d26260e99c7924d31e7e6011404e');
  assert.equal(manifest.source_tree, '68160433df889e4f3234d0f00d030b919b06fe6e');
  assert.equal(manifest.source_validated_head, manifest.source_head);
  assert.equal(manifest.carrier_head, '384101721eaa10922bf89820963081ec04849178');
  assert.equal(manifest.artifact_id, 14178550878);
  assert.equal(manifest.artifact_zip_sha256, '745e8870a2165db4564ead54f7a064bec295560d1ce2f1933b6e7c7933f41705');
  assert.equal(manifest.compiler_sha256, '74f36256ac16c25c6e009eb8b6f335ca6df66a20f42031af2a7bbbb05c6c297d');
  assert.equal(manifest.compiler_bytes, 502451);
  assert.equal(manifest.compiler_import_count, 0);
  assert.equal(manifest.compiler_abi, 2);
  assert.equal(manifest.guest_abi, 'atto.browser.guest.v2');
  assert.deepEqual(manifest.features, {caller_trap:true, ordinary_throw:true, nested_option_result:true, lexical_pure:true});
  assert.equal(manifest.conformance.passed, 371);
  assert.equal(manifest.conformance.failed, 0);
  assert.equal(manifest.conformance.native_wasm_byte_compares, 334);
  assert.equal(manifest.conformance.chromium_browser, true);
  assert.equal(manifest.conformance.java_differential, false);
  assert.equal(manifest.public_disclosure_approved, false);
  assert.ok(Date.parse(manifest.artifact_expires_at) > Date.parse('2026-11-15T20:06:51Z'));
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
