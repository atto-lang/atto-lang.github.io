import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const manifestUrl = new URL('../release-candidates/2026-11-13-rust-wasm.json', import.meta.url);
const verifierUrl = new URL('../tools/verify-compiler-candidate.mjs', import.meta.url);

test('candidate metadata is bound to a real source tree and digest but cannot authorize publication', async () => {
  const r = JSON.parse(await readFile(manifestUrl, 'utf8'));
  const pin = JSON.parse(await readFile(new URL('../public/atto_compiler.receipt.json', import.meta.url), 'utf8'));
  assert.equal(r.schema, 'atto.browser.compiler.candidate.v1');
  assert.equal(r.status, 'verified_candidate_unpublished');
  assert.equal(r.public_disclosure_approved, false);
  assert.equal(r.source_repository, 'atto-lang/atto-source.rs');
  assert.match(r.source_head, /^[a-f0-9]{40}$/);
  assert.match(r.source_tree, /^[a-f0-9]{40}$/);
  assert.match(r.compiler_sha256, /^[a-f0-9]{64}$/);
  assert.ok(r.compiler_bytes > 100_000 && r.compiler_bytes <= 1_048_576);
  assert.equal(r.compiler_abi, 2);
  assert.equal(r.guest_abi, 'atto.browser.guest.v2');
  assert.notEqual(pin.compiler_sha256, r.compiler_sha256,
    'staging metadata alone must never silently re-pin the public compiler');
});

test('candidate verifier refuses missing / invalid source artifacts without updating public assets', async () => {
  const before = await readFile(new URL('../src/compiler-pin.js', import.meta.url), 'utf8');
  const run = spawnSync(process.execPath, [verifierUrl.pathname, '/nonexistent/atto_compiler.wasm'], {
    encoding: 'utf8', timeout: 5000
  });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /ENOENT|no such file or directory/i);
  assert.equal(await readFile(new URL('../src/compiler-pin.js', import.meta.url), 'utf8'), before);
});

test('public packaging does not allowlist private candidate manifests or unverifiable compiler bytes', async () => {
  const packager = await readFile(new URL('../../.github/scripts/package-playground.mjs', import.meta.url), 'utf8');
  assert.ok(packager.includes('atto_compiler.wasm'), 'reviewed compiler asset must remain explicit');
  assert.ok(!packager.includes('release-candidates/'), 'candidate-only metadata must never be published');
});
