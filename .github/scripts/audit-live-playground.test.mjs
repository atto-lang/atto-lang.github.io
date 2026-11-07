import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { ASSETS } from './package-playground.mjs';
import { auditLivePlayground, PUBLIC_ORIGIN, FORBIDDEN } from './audit-live-playground.mjs';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const SHA = 'a'.repeat(40);
const files = new Map(await Promise.all(ASSETS.map(async name =>
  ['/play/' + name, await readFile(new URL('../../play/' + name, import.meta.url))])));
const COMPILER = digest(files.get('/play/public/atto_compiler.wasm'));
const base = {
  schema:1, source_commit:SHA, compiler_sha256:COMPILER,
  assets:Object.fromEntries([...files].map(([name,bytes]) =>
    [name.slice(1),{size:bytes.length,sha256:digest(bytes)}]))
};
const contentType = p => p.endsWith('.wasm') ? 'application/wasm' :
  p.endsWith('.js') ? 'text/javascript' :
  p.endsWith('.html') ? 'text/html; charset=utf-8' :
  p.endsWith('.json') ? 'application/json' : 'application/octet-stream';
const respond = (body, status=200, type='application/octet-stream') =>
  new Response(body,{status,headers:{'content-type':type}});
function fixture({manifest=structuredClone(base), overrides={}, records=[]}={}) {
  const fetchImpl = async (url,init) => {
    assert.ok(url.startsWith(PUBLIC_ORIGIN+'/'), 'never fetch third-party endpoints');
    assert.equal(init.method,'GET');
    assert.equal(init.redirect,'error');
    assert.equal(init.cache,'no-store');
    records.push(url);
    const path=url.slice(PUBLIC_ORIGIN.length);
    if (Object.hasOwn(overrides,path)) {
      const response=overrides[path];
      return typeof response==='function'?response():response;
    }
    if (path==='/release-manifest.json')
      return respond(JSON.stringify(manifest),200,'application/json');
    if (files.has(path))
      return respond(files.get(path),200,contentType(path));
    if (FORBIDDEN.includes(path)) return respond('not found',404,'text/plain');
    throw new Error('unexpected path '+path);
  };
  return {fetchImpl, expectedCommit:SHA, approvedCompilerSha256:COMPILER};
}
const shouldFail = async (opts,pattern=/NOT_CERTIFIED/) =>
  assert.rejects(auditLivePlayground(opts),pattern);

test('actual approved tree passes exact manifest, Wasm MIME, CSP and forbidden path probes',async()=>{
  const records=[];
  const receipt=await auditLivePlayground(fixture({records}));
  assert.equal(receipt.status,'LIVE_HTTP_VERIFIED');
  assert.equal(receipt.checked_assets,ASSETS.length);
  assert.equal(receipt.forbidden_probes,FORBIDDEN.length);
  assert.equal(receipt.compiler_sha256,COMPILER);
  assert.equal(records.length,1+ASSETS.length+FORBIDDEN.length);
  assert.ok(!ASSETS.includes('BUILD_RECEIPT.md'));
  assert.ok(records.includes(PUBLIC_ORIGIN+'/play/BUILD_RECEIPT.md'));
});
test('no approval, malformed SHA or alternate origin fails before network',async()=>{
  for(const overrides of [
    {expectedCommit:''},{expectedCommit:'b'.repeat(40)},
    {approvedCompilerSha256:'x'.repeat(64)},{approvedCompilerSha256:undefined},
    {origin:'https://attacker.example'}
  ]) {
    let called=0;
    await shouldFail({...fixture(),...overrides,
      fetchImpl:async()=>{called++;throw new Error('should not fetch')}});
    // Mismatched yet correctly formed SHA values must still inspect deployed
    // release metadata; malformed inputs and origins must never issue a fetch.
    if(overrides.expectedCommit==='' ||
       overrides.approvedCompilerSha256===undefined ||
       overrides.approvedCompilerSha256?.startsWith('x') ||
       overrides.origin)
      assert.equal(called,0);
  }
});
test('manifest missing, stale, malformed or unallowlisted fails closed',async()=>{
  await shouldFail(fixture({overrides:{
    '/release-manifest.json':respond('not found',404,'text/html')
  }}));
  await shouldFail(fixture({overrides:{
    '/release-manifest.json':respond('{',200,'application/json')
  }}),/Unexpected end|JSON/);
  await shouldFail(fixture({manifest:{...base,source_commit:'b'.repeat(40)}}));
  await shouldFail(fixture({manifest:{...base,compiler_sha256:'b'.repeat(64)}}));
  const extra=structuredClone(base);extra.assets['play/tests/secret.js']={size:1,sha256:'a'.repeat(64)};
  await shouldFail(fixture({manifest:extra}));
  const missing=structuredClone(base);delete missing.assets['play/index.html'];
  await shouldFail(fixture({manifest:missing}));
});
test('manifest entries cannot hide invalid sizes or hashes',async()=>{
  for(const entry of [
    {size:0,sha256:'a'.repeat(64)},
    {size:1.2,sha256:'a'.repeat(64)},
    {size:1,sha256:'not-sha'},
    null
  ]) {
    const manifest=structuredClone(base);
    manifest.assets['play/index.html']=entry;
    await shouldFail(fixture({manifest}));
  }
});
test('tampered live Wasm, HTML and JS are not certified',async()=>{
  for(const path of ['/play/public/atto_compiler.wasm','/play/index.html','/play/src/app.js']) {
    const overrides={[path]:respond('tampered',200,contentType(path))};
    await shouldFail(fixture({overrides}),/digest mismatch/);
  }
});
test('Wasm, module JavaScript and HTML must have safe MIME',async()=>{
  for(const path of ['/play/public/atto_compiler.wasm','/play/src/app.js','/play/index.html']) {
    const overrides={[path]:respond(files.get(path),200,'text/plain')};
    await shouldFail(fixture({overrides}),/MIME mismatch/);
  }
});
test('CSP cannot silently weaken even when manifest matches new HTML',async()=>{
  const bad=Buffer.from(files.get('/play/index.html').toString('utf8')
    .replace("default-src 'none'","default-src *"));
  const manifest=structuredClone(base);
  manifest.assets['play/index.html']={size:bad.length,sha256:digest(bad)};
  await shouldFail(fixture({manifest,overrides:{
    '/play/index.html':respond(bad,200,'text/html; charset=utf-8')
  }}),/CSP/);
});
test('publicly exposed forbidden files invalidate the deployment',async()=>{
  for (const path of FORBIDDEN) {
    const overrides={[path]:respond('EXPOSED',200,'text/plain')};
    await shouldFail(fixture({overrides}),/build\/test path exposed/);
  }
});
test('wrong status, redirected reads and failed network never certify',async()=>{
  await shouldFail(fixture({overrides:{
    '/play/public/atto_compiler.wasm':respond('unavailable',403,'text/plain')
  }}));
  await shouldFail(fixture({overrides:{
    '/release-manifest.json':{status:200,redirected:true}
  }}));
  await shouldFail({...fixture(),fetchImpl:async()=>{throw new Error('DNS unavailable')}},/DNS unavailable/);
});
test('release workflow postflight is read-only and cannot deploy itself',async()=>{
  const flow=await readFile(new URL('../workflows/live-public-playground-audit.yml',import.meta.url),'utf8');
  assert.match(flow,/schedule:/);
  assert.match(flow,/workflow_run:/);
  assert.match(flow,/workflow_dispatch:/);
  assert.match(flow,/audit-live-playground\.mjs/);
  assert.match(flow,/permissions:\n\s+contents: read/);
  assert.ok(!flow.includes('pages: write') && !flow.includes('id-token: write'));
});
