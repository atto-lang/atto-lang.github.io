import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {verifyActorPipelineCandidate, admitCandidateGuestWasm} from '../tools/verify-actor-pipeline-v3-candidate.mjs';

const receiptUrl = new URL('../release-candidates/2026-11-13-actor-pipeline-v3-rust-wasm.json', import.meta.url);

test('v3 candidate receipt is exact-source, nonpublic and not a release authorization', async () => {
  const data = JSON.parse(await readFile(receiptUrl, 'utf8'));
  assert.equal(data.status, 'verified_candidate_unpublished');
  assert.equal(data.public_disclosure_approved, false);
  assert.equal(data.source_tree, data.carrier_tree);
  assert.match(data.source_head, /^[a-f0-9]{40}$/);
  assert.match(data.carrier_head, /^[a-f0-9]{40}$/);
  assert.match(data.compiler_sha256, /^[a-f0-9]{64}$/);
  assert.equal(data.compiler_import_count, 0);
  assert.equal(data.features.actor_pipeline_v3, true);
  assert.equal(data.conformance.failed, 0);
  assert.equal(data.conformance.chromium_browser, true);
  assert.equal(data.production_host_probe.source_compiled_wasm, true);
});

test('candidate gate requires an explicit local Wasm path, never an arbitrary URL', async () => {
  await assert.rejects(verifyActorPipelineCandidate(), /explicit path/);
  await assert.rejects(verifyActorPipelineCandidate('https://example.com/a'), /explicit path/);
  await assert.rejects(verifyActorPipelineCandidate('artifact.zip'), /explicit path/);
});


const WASM32 = [0, 97, 115, 109, 1, 0, 0, 0];
// Standalone core Wasm memory sections; verifyCandidate's exported helper must
// reject them BEFORE WebAssembly.compile / actor-host instantiation.
const memoryOnly = (flags, min, max = min) => new Uint8Array([
  ...WASM32, 5, flags === 0 ? 3 : 4, 1, flags, min,
  ...(flags === 0 ? [] : [max]),
]);

test('actor-pipeline candidate proof uses the production bounded private Wasm32 memory gate', () => {
  const admitted = memoryOnly(1, 1, 16);
  assert.equal(WebAssembly.validate(admitted), true);
  assert.equal(admitCandidateGuestWasm(admitted).memoryCount, 1);
  const overQuota = memoryOnly(1, 1, 17);
  assert.equal(WebAssembly.validate(overQuota), true);
  assert.throws(() => admitCandidateGuestWasm(overQuota), /E_ACTOR_MEMORY: declared memory exceeds 16 pages/);
  const unbounded = memoryOnly(0, 1);
  assert.equal(WebAssembly.validate(unbounded), true);
  assert.throws(() => admitCandidateGuestWasm(unbounded), /E_ACTOR_MEMORY: bounded private Wasm32 memory required/);
  assert.throws(() => admitCandidateGuestWasm(new Uint8Array(1 << 20 | 1)),
    /E_GUEST_ADMISSION: invalid or oversized/);
  assert.throws(() => admitCandidateGuestWasm(new Uint8Array([1, 2, 3, 4])),
    /E_GUEST_ADMISSION: invalid or oversized/);
});
