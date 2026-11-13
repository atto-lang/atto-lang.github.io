import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { ASSETS } from './package-playground.mjs';

const bytes = path => readFile(new URL('../../' + path, import.meta.url));

test('merged browser-actor release compiler provenance is preserved', async () => {
  const wasm = await bytes('play/public/atto_compiler.wasm');
  const receipt = JSON.parse((await bytes('play/public/atto_compiler.receipt.json')).toString('utf8'));
  const pin = (await bytes('play/src/compiler-pin.js')).toString('utf8');
  assert.equal(receipt.compiler_sha256, createHash('sha256').update(wasm).digest('hex'));
  assert.equal(receipt.guest_abi, 'atto.browser.guest.v2');
  assert.ok(pin.includes(receipt.compiler_sha256), 'compiler bytes must match pinned digest');
  const mod = new WebAssembly.Module(wasm);
  assert.deepEqual(WebAssembly.Module.imports(mod), []);
  for (const path of ['play/src/actor-host.js','play/src/actor-worker.js',
    'play/examples/actors.atto','play/examples/classes.atto','play/examples/enums.atto']) {
    await access(new URL('../../' + path, import.meta.url));
  }
});

test('approved Pages packager retains actor assets, excludes internal source and build receipts', () => {
  for (const asset of ['src/actor-host.js','src/actor-worker.js','src/compiler.js',
    'examples/actors.atto','examples/classes.atto','examples/enums.atto']) {
    assert.ok(ASSETS.includes(asset), 'missing reviewed browser asset ' + asset);
  }
  for (const name of ['BUILD_RECEIPT.md','tests/browser-e2e.mjs','package.json','scripts/vendor-compiler.sh']) {
    assert.ok(!ASSETS.includes(name), 'private source artifact would be published: ' + name);
  }
});

test('legacy Jekyll mitigation and manual-release security guards remain distinct', async () => {
  const config = (await bytes('_config.yml')).toString();
  for (const name of ['play/tests','play/scripts','play/package.json',
    'play/package-lock.json','play/BUILD_RECEIPT.md']) {
    assert.ok(config.includes('  - ' + name), 'missing legacy Jekyll exclusion ' + name);
  }
  const release = (await bytes('.github/workflows/approved-playground-pages.yml')).toString();
  for (const required of ['check-pages-source.mjs','check-deployment-environment.mjs',
    'check-approved-compiler.mjs','audit-live-playground.mjs']) {
    assert.ok(release.includes(required), 'missing manual release safeguard ' + required);
  }
  const live = (await bytes('.github/workflows/live-public-playground-audit.yml')).toString();
  assert.ok(live.includes('audit-live-playground.mjs'));
  assert.ok(live.includes('contents: read'));
  assert.ok(!live.includes('pages: write'), 'live auditor must never publish');
});
