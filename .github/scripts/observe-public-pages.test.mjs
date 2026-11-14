import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { COMPILER_SHA256 } from '../../play/src/compiler-pin.js';
import { PUBLIC_ORIGIN, FORBIDDEN } from './audit-live-playground.mjs';
import { observePublicPages } from './observe-public-pages.mjs';

const COMMIT = 'a'.repeat(40);
const wasm = await readFile(new URL('../../play/public/atto_compiler.wasm', import.meta.url));
assert.equal(createHash('sha256').update(wasm).digest('hex'), COMPILER_SHA256);
const receipt = await readFile(new URL('../../play/public/atto_compiler.receipt.json', import.meta.url));
const manifest = JSON.stringify({schema: 1, source_commit: COMMIT, compiler_sha256: COMPILER_SHA256, assets:{}});
const reply = (body, type, status=200) => new Response(body, {
  status, headers: {'content-type': type}
});
const valid = {
  '/release-manifest.json': () => reply(manifest, 'application/json'),
  '/play/public/atto_compiler.wasm': () => reply(wasm, 'application/wasm'),
  '/play/public/atto_compiler.receipt.json': () => reply(receipt, 'application/json')
};
function fixture({overrides={}, seen=[]}={}) {
  const fetchImpl = async (url, init) => {
    assert.ok(url.startsWith(PUBLIC_ORIGIN + '/'), 'no requests to third-party origins');
    assert.equal(init.method, 'GET');
    assert.equal(init.redirect, 'error');
    assert.equal(init.cache, 'no-store');
    const path = url.slice(PUBLIC_ORIGIN.length);
    seen.push(path);
    if (Object.hasOwn(overrides,path)) {
      const response=overrides[path];
      return typeof response==='function' ? response() : response;
    }
    if (Object.hasOwn(valid,path)) return valid[path]();
    if (FORBIDDEN.includes(path)) return reply('not found','text/plain',404);
    throw new Error('Unexpected request path '+path);
  };
  return {fetchImpl,expectedCommit:COMMIT};
}

test('observation is never a release certificate even when all observed hashes match', async () => {
  const seen=[];
  const result=await observePublicPages(fixture({seen}));
  assert.equal(result.status,'OBSERVATION_ONLY_NOT_CERTIFIED');
  assert.equal(result.observed_compiler_sha256, COMPILER_SHA256);
  assert.equal(result.manifest_source_commit, COMMIT);
  assert.equal(result.exposed_paths,0);
  assert.deepEqual(result.findings,[]);
  assert.equal(result.forbidden_paths_checked,FORBIDDEN.length);
  assert.equal(seen.length,3+FORBIDDEN.length);
});

test('public source exposure is recorded even when release manifest is missing', async () => {
  const seen=[];
  const result=await observePublicPages(fixture({seen,overrides:{
    '/release-manifest.json': reply('not found','text/plain',404),
    '/play/package.json': reply('private source','application/json',200),
    '/play/tests/browser-e2e.mjs': reply('test source','text/javascript',200)
  }}));
  assert.equal(result.status,'OBSERVATION_ONLY_NOT_CERTIFIED');
  assert.equal(result.exposed_paths,2);
  assert.ok(result.findings.some(x=>x.includes('release-manifest.json: HTTP 404')));
  assert.ok(result.findings.some(x=>x.includes('forbidden public path /play/package.json')));
  assert.ok(result.findings.some(x=>x.includes('forbidden public path /play/tests/browser-e2e.mjs')));
  for (const path of FORBIDDEN) assert.ok(seen.includes(path),'must probe '+path);
});

test('observed compiler bytes, receipt and source commit cannot be silently substituted', async () => {
  const corrupted=new Uint8Array(wasm);
  corrupted[corrupted.length-1]^=1;
  const badManifest=JSON.stringify({schema:1,source_commit:'b'.repeat(40),
    compiler_sha256:'c'.repeat(64)});
  const badReceipt=JSON.stringify({compiler_sha256:'d'.repeat(64),compiler_bytes:12});
  const result=await observePublicPages(fixture({overrides:{
    '/release-manifest.json':reply(badManifest,'application/json'),
    '/play/public/atto_compiler.wasm':reply(corrupted,'application/wasm'),
    '/play/public/atto_compiler.receipt.json':reply(badReceipt,'application/json')
  }}));
  assert.ok(result.findings.some(x=>x.includes('current source commit')));
  assert.ok(result.findings.some(x=>x.includes('manifest compiler digest')));
  assert.ok(result.findings.some(x=>x.includes('public Wasm bytes')));
  assert.ok(result.findings.some(x=>x.includes('public receipt compiler digest')));
  assert.ok(result.findings.some(x=>x.includes('public receipt compiler size')));
});

test('unexpected origin and malformed expectations refuse network access', async () => {
  for(const settings of [
    {origin:'https://attacker.example'},
    {expectedCommit:'bad'},
    {expectedCompilerSha256:'bad'}
  ]) {
    let calls=0;
    await assert.rejects(observePublicPages({
      ...fixture(),...settings,fetchImpl:async()=>{calls++;throw Error('should not run')}
    }));
    assert.equal(calls,0);
  }
});

test('invalid MIME, oversized responses, redirects and probe network errors fail closed', async () => {
  const result=await observePublicPages(fixture({overrides:{
    '/release-manifest.json':reply(manifest,'text/plain'),
    '/play/public/atto_compiler.wasm':new Response(wasm,{headers:{
      'content-type':'application/wasm','content-length':'1048577'
    }}),
    '/play/public/atto_compiler.receipt.json':{status:200,redirected:true},
    '/play/tests/browser-e2e.mjs':()=>{throw new Error('network unavailable')}
  }}));
  assert.ok(result.findings.some(x=>x.includes('MIME mismatch')));
  assert.ok(result.findings.some(x=>x.includes('invalid Content-Length')));
  assert.ok(result.findings.some(x=>x.includes('Invalid or redirected')));
  assert.ok(result.findings.some(x=>x.includes('probe failed /play/tests/browser-e2e.mjs')));
});
