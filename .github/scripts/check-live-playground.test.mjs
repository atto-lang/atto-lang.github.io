import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { auditLivePlayground, NON_RELEASE_PATHS } from './check-live-playground.mjs';
import { ASSETS } from './package-playground.mjs';

const wasm = await readFile(new URL('../../play/public/atto_compiler.wasm', import.meta.url));
const digest = createHash('sha256').update(wasm).digest('hex');
const manifest = {
  schema: 1,
  source_commit: 'a'.repeat(40),
  compiler_sha256: digest,
  assets: Object.fromEntries(ASSETS.map(name => ['play/' + name, {
    size: name === 'public/atto_compiler.wasm' ? wasm.length : 8,
    sha256: name === 'public/atto_compiler.wasm' ? digest : 'b'.repeat(64)
  }]))
};
function simulatedSite(override = {}) {
  const resources = {
    '/play/': {status:200,type:'text/html',body:'<textarea id="source"></textarea><script src="./src/app.js"></script>'},
    '/release-manifest.json': {status:200,type:'application/json',body:JSON.stringify(manifest)},
    '/play/public/atto_compiler.wasm': {status:200,type:'application/wasm',body:wasm},
    ...override
  };
  return async url => {
    assert.equal(new URL(url).origin, 'https://atto-lang.github.io');
    const data = resources[new URL(url).pathname] ?? {status:404,type:'text/plain',body:'Not Found'};
    return new Response(data.body, {status:data.status,headers:{'content-type':data.type}});
  };
}
test('accepts only the exact reviewed Wasm, manifest and hidden non-allowlisted paths', async () => {
  const result = await auditLivePlayground({fetchImpl:simulatedSite(),localCompiler:wasm});
  assert.equal(result.compiler_sha256,digest);
  assert.equal(result.rejected_private_paths,7);
});
test('detects legacy Pages publication that leaks test source or package metadata', async () => {
  for (const path of ['/play/tests/browser-e2e.mjs','/play/tests/ui.test.mjs','/play/package.json']) {
    const site=simulatedSite({[path]:{status:200,type:'text/javascript',body:'exposed'}});
    await assert.rejects(auditLivePlayground({fetchImpl:site,localCompiler:wasm}),/Unreviewed file is publicly exposed/);
  }
});
test('fails closed on missing release manifest or unreviewed compiler digest', async () => {
  await assert.rejects(auditLivePlayground({
    fetchImpl:simulatedSite({'/release-manifest.json':{status:404,type:'text/plain',body:'Not Found'}}),
    localCompiler:wasm
  }),/expected HTTP 200/);
  await assert.rejects(auditLivePlayground({
    fetchImpl:simulatedSite({'/release-manifest.json':{status:200,type:'application/json',body:JSON.stringify({...manifest,compiler_sha256:'0'.repeat(64)})}}),
    localCompiler:wasm
  }),/does not match/);
});
test('rejects incorrect Wasm MIME and missing browser editor', async () => {
  await assert.rejects(auditLivePlayground({
    fetchImpl:simulatedSite({'/play/public/atto_compiler.wasm':{status:200,type:'application/octet-stream',body:wasm}}),
    localCompiler:wasm
  }),/wrong MIME/);
  await assert.rejects(auditLivePlayground({
    fetchImpl:simulatedSite({'/play/':{status:200,type:'text/html',body:'<h1>Site works</h1>'}}),
    localCompiler:wasm
  }),/did not serve/);
});

test('reports leaked source even when the release manifest is absent', async () => {
  const site = simulatedSite({
    '/release-manifest.json': {status:404,type:'text/plain',body:'Not Found'},
    '/play/tests/browser-e2e.mjs': {status:200,type:'text/javascript',body:'exposed'}
  });
  await assert.rejects(auditLivePlayground({fetchImpl:site,localCompiler:wasm}), error =>
    /release-manifest.json expected HTTP 200/.test(error.message) &&
    /Unreviewed file is publicly exposed/.test(error.message));
});

test('denylisted URLs never overlap the canonical public release allowlist', () => {
  const permitted = new Set(ASSETS.map(name => 'play/' + name));
  assert.ok(permitted.has('play/BUILD_RECEIPT.md'), 'provenance receipt is intentionally released');
  assert.ok(NON_RELEASE_PATHS.includes('play/tests/ui.test.mjs'));
  for (const path of NON_RELEASE_PATHS) assert.ok(!permitted.has(path), 'incorrectly denied approved asset: ' + path);
});

test('manifest rejects extra, missing, malformed and unapproved asset paths', async () => {
  const withoutEditor = structuredClone(manifest);
  delete withoutEditor.assets['play/src/editor.js'];
  const withSource = structuredClone(manifest);
  withSource.assets['play/tests/ui.test.mjs'] = { size: 8, sha256: 'b'.repeat(64) };
  const badSize = structuredClone(manifest);
  badSize.assets['play/src/ui.js'].size = 0;
  const badHash = structuredClone(manifest);
  badHash.assets['play/src/app.js'].sha256 = 'not-a-digest';
  for (const invalid of [withoutEditor, withSource, badSize, badHash]) {
    await assert.rejects(auditLivePlayground({
      fetchImpl: simulatedSite({'/release-manifest.json': {
        status: 200, type: 'application/json', body: JSON.stringify(invalid)
      }}),
      localCompiler: wasm
    }), /exact reviewed asset allowlist/);
  }
});
