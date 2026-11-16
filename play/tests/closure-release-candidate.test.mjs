import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

const root = new URL('../', import.meta.url);
const read = name => readFileSync(new URL(name, root));
const staged = JSON.parse(read('release-candidates/2026-11-15-closures-functors-rust-wasm.json'));
const published = JSON.parse(read('public/atto_compiler.receipt.json'));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const gitBlob = bytes => createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');

test('private candidate record pins exact /play/ source and compiler source Git tree', () => {
  assert.equal(staged.schema, 'atto.playground.compiler.closure-candidate.v1');
  assert.equal(staged.status, 'verified_private_candidate_unpublished');
  assert.equal(staged.public_disclosure_approved, false);
  assert.equal(staged.release_approved, false);
  assert.equal(staged.source_repository, 'atto-lang/atto-source.rs');
  assert.equal(staged.source_head, '2ce03b0ebbb9473dbefcfe5918dda446216fd1a0');
  assert.equal(staged.source_tree, '4598100f13a81587264356a5a6cddea43370fa3f');
  // Historical record: the preview header was later revised once the public
  // compiler (atto-source.rs c633301) began executing it; the record keeps the
  // exact source blob the private candidate was verified against.
  assert.equal(staged.site_example_git_blob, '5d3fa82fa5c554f2a92ad7c5bb75f43a7dc7c977');
  assert.notEqual(gitBlob(read('examples/preview/closures-functors.atto')), staged.site_example_git_blob);
  assert.match(staged.verification_run,
    /^https:\/\/github\.com\/zed-pkg-test\/oreslang-private-pr-validation-20261012\/actions\/runs\/43756005890$/);
  assert.equal(staged.expected_guest_return, '84');
});

test('recorded private candidate cannot replace public compiler without approval', () => {
  assert.match(staged.candidate_compiler_sha256, /^[a-f0-9]{64}$/);
  assert.match(staged.guest_sha256, /^[a-f0-9]{64}$/);
  assert.equal(staged.compiler_abi, published.compiler_abi);
  assert.equal(staged.guest_abi, published.guest_abi);
  assert.equal(published.source_head, 'c6333016df239e9eff66411563fc1ad768d62376');
  assert.notEqual(staged.candidate_compiler_sha256, published.compiler_sha256);
  assert.equal(sha256(read('public/atto_compiler.wasm')), published.compiler_sha256,
    'the public compiler must be the reviewed vendored bytes named by the receipt');
  const app = read('src/app.js').toString('utf8');
  assert.match(app, /"preview\/closures-functors"/,
    'closures-functors stays a registered preview');
});

test('candidate proof has real executed evidence and lists explicit release blockers', () => {
  assert.deepEqual(staged.verification_summary, {
    source_free_policy_tests_passed: 6,
    rust_wasm_guest_conformance_passed: 366,
    native_vs_wasm_comparisons: 329,
    chromium_passed: true,
    full_source_tree_verified: true,
    exact_site_source_executed: true
  });
  assert.equal(staged.release_blockers.length, 5);
  assert.ok(staged.release_blockers.some(x => /independent compiler source review/.test(x)));
});
