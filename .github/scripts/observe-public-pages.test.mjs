import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { COMPILER_SHA256 } from '../../play/src/compiler-pin.js';
import { PUBLIC_ORIGIN, FORBIDDEN } from './audit-live-playground.mjs';
import { observePublicPages } from './observe-public-pages.mjs';
import { MAX_COMPILER_BYTES } from './package-playground.mjs';

const COMMIT = 'a'.repeat(40);
const wasm = await readFile(new URL('../../play/public/atto_compiler.wasm', import.meta.url));
assert.equal(createHash('sha256').update(wasm).digest('hex'), COMPILER_SHA256);
const receipt = await readFile(new URL('../../play/public/atto_compiler.receipt.json', import.meta.url));
const manifest = JSON.stringify({schema: 1, source_commit: COMMIT, compiler_sha256: COMPILER_SHA256, assets:{}});
const deckHtml = await readFile(new URL('../../deck/index.html', import.meta.url));
const deckCss = await readFile(new URL('../../deck/deck.css', import.meta.url));
const deckJs = await readFile(new URL('../../deck/deck.js', import.meta.url));
const reply = (body, type, status=200) => new Response(body, {
  status, headers: {'content-type': type}
});
const valid = {
  '/release-manifest.json': () => reply(manifest, 'application/json'),
  '/play/public/atto_compiler.wasm': () => reply(wasm, 'application/wasm'),
  '/play/public/atto_compiler.receipt.json': () => reply(receipt, 'application/json'),
  '/deck/': () => reply(deckHtml, 'text/html'),
  '/deck/index.html': () => reply(deckHtml, 'text/html'),
  '/deck/deck.css': () => reply(deckCss, 'text/css'),
  '/deck/deck.js': () => reply(deckJs, 'text/javascript'),
  '/deck': () => new Response(null, {status:301,headers:{location:'/deck/'}})
};
function fixture({overrides={}, seen=[]}={}) {
  const fetchImpl = async (url, init) => {
    assert.ok(url.startsWith(PUBLIC_ORIGIN + '/'), 'no requests to third-party origins');
    assert.equal(init.method, 'GET');
    const path = url.slice(PUBLIC_ORIGIN.length);
    assert.equal(init.redirect, path === '/deck' ? 'manual' : 'error');
    assert.equal(init.cache, 'no-store');
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
  assert.equal(seen.length,8+FORBIDDEN.length);
  for (const path of ['/deck','/deck/','/deck/index.html','/deck/deck.css','/deck/deck.js'])
    assert.ok(seen.includes(path), 'deck route or asset omitted: '+path);
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
      'content-type':'application/wasm','content-length':String(MAX_COMPILER_BYTES + 1)
    }}),
    '/play/public/atto_compiler.receipt.json':{status:200,redirected:true},
    '/play/tests/browser-e2e.mjs':()=>{throw new Error('network unavailable')}
  }}));
  assert.ok(result.findings.some(x=>x.includes('MIME mismatch')));
  assert.ok(result.findings.some(x=>x.includes('invalid Content-Length')));
  assert.ok(result.findings.some(x=>x.includes('Invalid or redirected')));
  assert.ok(result.findings.some(x=>x.includes('probe failed /play/tests/browser-e2e.mjs')));
});


test('compressed public responses do not cause false wire-length findings', async () => {
  const response = (body, type, encoding) => new Response(body,{headers:{
    'content-type':type, 'content-encoding':encoding, 'content-length':'9'
  }});
  for (const encoding of ['gzip','br','deflate']) {
    const result=await observePublicPages(fixture({overrides:{
      '/release-manifest.json': response(manifest,'application/json',encoding),
      '/play/public/atto_compiler.wasm': response(wasm,'application/wasm',encoding),
      '/play/public/atto_compiler.receipt.json': response(receipt,'application/json',encoding)
    }}));
    assert.deepEqual(result.findings,[]);
    assert.equal(result.observed_compiler_sha256, COMPILER_SHA256);
  }
});

test('public observation still detects decoded tampering, oversize and invalid encoding', async () => {
  const corrupted=Buffer.from(wasm);
  corrupted[10]^=1;
  const response = (body, encoding, length='8') => new Response(body,{headers:{
    'content-type':'application/wasm','content-encoding':encoding,'content-length':length
  }});
  for(const [data,encoding,expected] of [
    [corrupted,'br','public Wasm bytes differ'],
    [Buffer.concat([wasm,Buffer.alloc(MAX_COMPILER_BYTES)]),'gzip','oversized response'],
    [wasm,'identity','mismatched Content-Length'],
    [wasm,'zstd','unsupported Content-Encoding'],
    [wasm,'gzip, br','unsupported Content-Encoding']
  ]) {
    const result=await observePublicPages(fixture({overrides:{
      '/play/public/atto_compiler.wasm':response(data,encoding)
    }}));
    assert.ok(result.findings.some(x=>x.includes(expected)),expected);
  }
});


test('unavailable or denied source paths remain findings, never confirmed file leaks', async () => {
  const path='/play/tests/ui.test.mjs';
  for (const status of [403,429,503]) {
    const result=await observePublicPages(fixture({overrides:{
      [path]:reply('not served','text/plain',status)
    }}));
    assert.equal(result.status,'OBSERVATION_ONLY_NOT_CERTIFIED');
    assert.equal(result.exposed_paths,0);
    assert.ok(result.findings.some(x=>x.includes('forbidden path probe inconclusive ' + path + ': HTTP ' + status)));
    assert.ok(!result.findings.some(x=>x.includes('forbidden public path ' + path)));
  }
  const result=await observePublicPages(fixture({overrides:{
    [path]:reply('LEAKED','text/plain',200)
  }}));
  assert.equal(result.exposed_paths,1);
  assert.ok(result.findings.some(x=>x.includes('forbidden public path ' + path)));
});

test('observation catches broken deck paths without suppressing forbidden probes', async () => {
  const seen=[];
  const result=await observePublicPages(fixture({seen,overrides:{
    '/deck/':reply('missing','text/plain',404),
    '/deck/deck.css':reply('tampered','text/css'),
    '/deck/deck.js':reply('unavailable','text/plain',503),
    '/deck':reply('missing','text/plain',404),
    '/play/tests/ui.test.mjs':reply('exposed','text/javascript',200)
  }}));
  for (const message of [
    '/deck/: HTTP 404',
    '/deck/deck.css: deployed deck differs',
    '/deck/deck.js: HTTP 503',
    '/deck: HTTP 404',
    'forbidden public path /play/tests/ui.test.mjs'
  ]) assert.ok(result.findings.some(x=>x.includes(message)), message);
  assert.equal(result.exposed_paths,1);
  for (const path of FORBIDDEN)
    assert.ok(seen.includes(path), 'deck failures suppressed forbidden probe '+path);
});

test('deck alias rejects off-origin redirects, wrong paths, bytes and MIME', async () => {
  for (const [response, expected] of [
    [new Response(null, {status:301,headers:{location:'https://evil.example/deck/'}}),'unsafe or incorrect canonical redirect'],
    [new Response(null, {status:302,headers:{location:'/play/'}}),'unsafe or incorrect canonical redirect'],
    [reply('wrong bytes','text/html'),'unreviewed route bytes'],
    [reply(deckHtml,'text/plain'),'MIME mismatch']
  ]) {
    const result=await observePublicPages(fixture({overrides:{'/deck':response}}));
    assert.ok(result.findings.some(x=>x.includes('/deck: '+expected)),expected);
    assert.equal(result.exposed_paths,0);
  }
});

test('unreadable local deck sources cannot suppress public exposure probes', async () => {
  const seen=[];
  const result=await observePublicPages({
    ...fixture({seen,overrides:{
      '/play/tests/ui.test.mjs':reply('exposed','text/javascript',200),
      '/deck':reply(deckHtml,'text/html')
    }}),
    readApprovedDeck:async url => {
      if (url.pathname.endsWith('/deck/index.html') ||
          url.pathname.endsWith('/deck/deck.css')) throw new Error('EACCES');
      return readFile(url);
    }
  });
  assert.equal(result.status,'OBSERVATION_ONLY_NOT_CERTIFIED');
  assert.equal(result.exposed_paths,1);
  for (const message of [
    '/deck/: approved local deck source unavailable',
    '/deck/index.html: approved local deck source unavailable',
    '/deck/deck.css: approved local deck source unavailable',
    'forbidden public path /play/tests/ui.test.mjs',
    '/deck:'
  ]) {
    assert.ok(result.findings.some(x=>x.includes(message)),message);
  }
  for (const path of FORBIDDEN)
    assert.ok(seen.includes(path),'missing source suppressed forbidden probe '+path);
});

test('zero-byte local deck source is recorded without interrupting forbidden probes', async () => {
  const seen=[];
  const result=await observePublicPages({
    ...fixture({seen}),
    readApprovedDeck:async url =>
      url.pathname.endsWith('/deck/deck.js') ? Buffer.alloc(0) : readFile(url)
  });
  assert.ok(result.findings.some(x=>x.includes(
    '/deck/deck.js: approved local deck source unavailable')));
  assert.equal(result.exposed_paths,0);
  for (const path of FORBIDDEN)
    assert.ok(seen.includes(path),'malformed source suppressed probe '+path);
});

test('deck JavaScript observation accepts standard MIME variants but rejects unsafe MIME', async () => {
  for (const type of ['text/javascript', 'application/javascript',
    'text/ecmascript', 'application/ecmascript']) {
    const result=await observePublicPages(fixture({overrides:{
      '/deck/deck.js':reply(deckJs,type)
    }}));
    assert.deepEqual(result.findings, [], 'valid JS MIME: '+type);
  }
  const invalid=await observePublicPages(fixture({overrides:{
    '/deck/deck.js':reply(deckJs,'text/plain')
  }}));
  assert.ok(invalid.findings.some(x=>x.includes('/deck/deck.js: MIME mismatch')));
  assert.equal(invalid.exposed_paths,0);
});

test('deck alias accepts an exact reviewed HTML response as well as canonical redirect', async () => {
  const result=await observePublicPages(fixture({overrides:{
    '/deck':reply(deckHtml,'text/html')
  }}));
  assert.deepEqual(result.findings,[]);
});
