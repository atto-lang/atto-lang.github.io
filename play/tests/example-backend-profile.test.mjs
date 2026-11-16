// Fail closed when a playground example, its advertised support tier or its
// public release packaging drifts out of the Rust/Wasm compiler contract.
// This static inventory complements the *executed* compiler.test.mjs guest tests:
// it is not a substitute for compiling the candidate PR or publishing a binary.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');
const profile = JSON.parse(await read('example-backend-profile.json'));
const receipt = JSON.parse(await read(profile.receipt));

test('the example inventory is explicitly pinned to the published Rust/Wasm ABI', () => {
  assert.equal(profile.schema, 'atto.play.example.backend-profile.v1');
  assert.equal(receipt.source_repository, 'atto-lang/atto-source.rs');
  assert.match(receipt.source_head, /^[0-9a-f]{40}$/);
  assert.match(receipt.source_tree, /^[0-9a-f]{40}$/);
  assert.match(receipt.compiler_sha256, /^[0-9a-f]{64}$/);
  assert.equal(receipt.compiler_abi, 2);
  assert.equal(receipt.guest_abi, 'atto.browser.guest.v2');
  assert.match(profile.release_gate, /native and wasm32 compiler parity/);
  assert.match(profile.release_gate, /approved public artifact/);
});

test('every published .atto sample is accounted for in exactly one support tier', async () => {
  const runnable = profile.runnable.map(x => x.name);
  const preview = profile.preview.map(x => x.name);
  assert.equal(new Set(runnable).size, runnable.length);
  assert.equal(new Set(preview).size, preview.length);
  assert.equal(runnable.filter(x => preview.includes(x)).length, 0);
  assert.deepEqual((await readdir(new URL('examples/', root)))
    .filter(x => x.endsWith('.atto')).map(x => x.slice(0, -5)).sort(), [...runnable].sort());
  assert.deepEqual((await readdir(new URL('examples/preview/', root)))
    .filter(x => x.endsWith('.atto')).map(x => x.slice(0, -5)).sort(), [...preview].sort());
  assert.deepEqual(runnable.map(x => profile.runnable.find(y => y.name === x).expect),
    ['exec', 'exec', 'exec', 'exec', 'panic', 'diagnostic', 'exec', 'guest-actor-v2-legacy', 'exec-llvm-design']);
  assert.ok(profile.preview.every(x => x.expect === 'preview-only'));
});

test('UI, catalog and static deployment allowlist agree with the support profile', async () => {
  const [html, app, release] = await Promise.all([
    read('index.html'), read('src/app.js'), read('../.github/scripts/package-playground.mjs')
  ]);
  const previewMatch = app.match(/const PREVIEW_EXAMPLES = new Set\((\[[^\n]+\])\)/);
  assert.ok(previewMatch, 'preview allowlist missing');
  assert.deepEqual(JSON.parse(previewMatch[1]), profile.preview.map(x => 'preview/' + x.name));
  const examplesMatch = app.match(/const EXAMPLES = \[([^\n]+)\];/);
  assert.ok(examplesMatch, 'runnable catalog missing');
  assert.deepEqual([...examplesMatch[1].matchAll(/'([a-z-]+)'/g)].map(m => m[1]),
    profile.runnable.map(x => x.name));
  const dropdown = [...html.matchAll(/<option value="([^"]+)"/g)].map(m => m[1]);
  for (const { name } of profile.runnable) {
    assert.equal(dropdown.filter(x => x === name).length, 1, name + ': runnable dropdown');
    assert.equal(release.split("'examples/" + name + ".atto'").length - 1, 1,
      name + ': release allowlist');
  }
  for (const { name } of profile.preview) {
    assert.equal(dropdown.filter(x => x === 'preview/' + name).length, 1,
      name + ': preview dropdown');
    assert.equal(release.split("'examples/preview/" + name + ".atto'").length - 1, 1,
      name + ': release allowlist');
    const file = await read('examples/preview/' + name + '.atto');
    assert.match(file, /^\/\/ (?:PREVIEW ONLY:|SYNTAX PREVIEW)/, name);
  }
  assert.match(html, /Language previews — not executable yet/);
  assert.match(app, /supportLabel\.dataset\.support = 'preview'/);
  assert.match(app, /runButton\.disabled = controlsDisabled/);
  assert.match(app, /formatButton\.disabled = controlsDisabled/);
  assert.match(app, /checkFormatButton\.disabled = controlsDisabled/);
});

test('the legacy actor and Boolean examples do not claim cross-backend parity', async () => {
  const actor = await read('examples/actors.atto');
  assert.match(actor, /one Web Worker; each actor has a distinct Wasm instance/);
  assert.match(actor, /not canonical sealed actor-state syntax/);
  assert.doesNotMatch(actor, /each spawned actor runs in its own Web Worker/);
  const conditions = await read('examples/conditions.atto');
  assert.match(conditions, /Atto currently reserves \^\^/);
  const booleanPreview = await read('examples/preview/boolean-operators.atto');
  assert.match(booleanPreview, /Oreslang Java recognizes &&, \|\| and \^\^/);
  assert.match(booleanPreview, /illustrative only/);
});
