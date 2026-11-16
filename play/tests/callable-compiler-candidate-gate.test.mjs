import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { verifyCandidate, CANDIDATE_NAMES } from '../tools/verify-compiler-candidate.mjs';

const name = '2026-11-15-callable-class-mtd-rust-wasm.json';
const jsonUrl = new URL('../release-candidates/' + name, import.meta.url);
const oldPinUrl = new URL('../public/atto_compiler.receipt.json', import.meta.url);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const gitBlob = bytes => createHash('sha1').update(Buffer.from('blob ' + bytes.length + '\0')).update(bytes).digest('hex');

test('merged compiler candidate has exact provenance and no disclosure approval', async () => {
  const manifest = JSON.parse(await readFile(jsonUrl, 'utf8'));
  assert.equal(manifest.schema, 'atto.browser.compiler.candidate.v1');
  assert.equal(manifest.status, 'verified_candidate_unpublished');
  assert.equal(manifest.public_disclosure_approved, false);
  assert.equal(manifest.source_repository, 'atto-lang/atto-source.rs');
  assert.equal(manifest.source_head, 'd06f76c3c5567b66168365caed11150ed6c95a3d');
  assert.equal(manifest.source_tree, '801633e32c525fb15d2aa362e98aa3be97e92472');
  assert.equal(manifest.compiler_sha256, '74c7c6992a3470aab649da99ca0c0312cd2ee9cb1f0a6811c9b6a0f3e3021250');
  assert.equal(manifest.compiler_bytes, 497331);
  assert.equal(manifest.carrier_repository, 'honeypot-r-us-test/hnpt-e2e');
  assert.equal(manifest.carrier_run, 'https://github.com/honeypot-r-us-test/hnpt-e2e/actions/runs/43766640840');
  assert.equal(manifest.artifact_id, 14182945347);
  assert.equal(manifest.artifact_zip_sha256, '4dd0ddf9c724bd04a76a1fcff2dc8ef665c5ed98de6811f7d3bbe28235f764c3');
  assert.deepEqual(manifest.conformance, {
    passed:361, failed:0, native_wasm_differential:324, chromium_browser:true
  });
  const pin = JSON.parse(await readFile(oldPinUrl, 'utf8'));
  assert.notEqual(pin.compiler_sha256, manifest.compiler_sha256,
    'candidate metadata must never silently replace live compiler bytes');
  assert.ok(CANDIDATE_NAMES.includes(name));
});

test('candidate fixture bytes are identical to executed private source corpus', async () => {
  for (const [fixture, expectedBlob] of [
    ['172-erlang-callable-bodies.atto','21ff2529c69ba166003c8b47cb5b7e0393007e37'],
    ['173-erlang-class-mtd.atto','85b731733178008d6c7467f2b3507b357aac5cf5']
  ]) {
    const bytes=await readFile(new URL('../release-candidates/fixtures/'+fixture,import.meta.url));
    assert.equal(gitBlob(bytes),expectedBlob);
  }
});

test('missing private Wasm artifact cannot trigger pin or asset publication', async () => {
  const pinUrl=new URL('../src/compiler-pin.js',import.meta.url);
  const wasmUrl=new URL('../public/atto_compiler.wasm',import.meta.url);
  const beforePin=await readFile(pinUrl);
  const beforeWasm=sha256(await readFile(wasmUrl));
  await assert.rejects(
    () => verifyCandidate('/nonexistent/private-candidate.wasm',{candidateName:name}),
    /ENOENT|no such file/i
  );
  assert.deepEqual(await readFile(pinUrl),beforePin);
  assert.equal(sha256(await readFile(wasmUrl)),beforeWasm);
});

test('public release packager and denylist do not expose any candidate resource', async () => {
  const packager=await readFile(new URL('../../.github/scripts/package-playground.mjs',import.meta.url),'utf8');
  assert.ok(!packager.includes('release-candidates/'));
  const audit=await readFile(new URL('../../.github/scripts/audit-live-playground.mjs',import.meta.url),'utf8');
  for(const blocked of [
    '/play/release-candidates/'+name,
    '/play/release-candidates/fixtures/172-erlang-callable-bodies.atto',
    '/play/release-candidates/fixtures/173-erlang-class-mtd.atto',
    '/play/tests/callable-compiler-candidate-gate.test.mjs',
  ]) assert.ok(audit.includes("'" + blocked + "'"),blocked);
});
