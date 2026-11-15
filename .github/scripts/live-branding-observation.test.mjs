import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {ORIGIN,ROUTES,IMAGES,observeBranding} from './live-branding-observation.mjs';
const read=p=>readFile(new URL('../../'+p,import.meta.url));
const routes=new Map(await Promise.all(ROUTES.map(async route=>[route.url,await read(route.source)])));
const images=new Map(await Promise.all(IMAGES.map(async p=>['/'+p,await read(p)])));
const response=(bytes,mime,status=200)=>new Response(bytes,{status,headers:{'content-type':mime}});
function fixture(overrides={},seen=[]){
  return {fetchImpl:async(url,opts)=>{
    assert.ok(url.startsWith(ORIGIN+'/'));
    assert.equal(opts.method,'GET');assert.equal(opts.redirect,'error');assert.equal(opts.cache,'no-store');
    const path=url.slice(ORIGIN.length);seen.push(path);
    if(Object.hasOwn(overrides,path))return overrides[path];
    if(images.has(path))return response(images.get(path),path.endsWith('.svg')?'image/svg+xml':'image/png');
    if(routes.has(path))return response(routes.get(path),'text/html; charset=utf-8');
    throw Error('unexpected URL '+path);
  }};
}
test('five approved static images and six site families are observed without release certification',async()=>{
  const seen=[];
  const result=await observeBranding(fixture({},seen));
  assert.equal(result.status,'BRANDING_OBSERVATION_ONLY_NOT_RELEASE_APPROVAL');
  assert.equal(result.all_visible,true);
  assert.equal(result.checked_routes,6);assert.equal(result.checked_assets,5);
  assert.equal(seen.length,11);
  assert.deepEqual(result.findings,[]);
});
test('altered images and missing favicon are not considered visible',async()=>{
  let result=await observeBranding(fixture({'/assets/atto-logo.svg':response('altered','image/svg+xml')}));
  assert.equal(result.all_visible,false);
  assert.match(result.findings.join(';'),/differs from approved/);
  result=await observeBranding(fixture({'/assets/favicon-32x32.png':response('missing','text/plain',404)}));
  assert.equal(result.all_visible,false);
  assert.match(result.findings.join(';'),/HTTP 404/);
});
test('each page must contain separate navigation and footer marks',async()=>{
  const html=routes.get('/play/').toString('utf8').replace(/<footer\b[\s\S]*?<\/footer>/i,'<footer>No brand</footer>');
  const result=await observeBranding(fixture({'/play/':response(html,'text/html')}));
  assert.equal(result.all_visible,false);
  assert.match(result.findings.join(';'),/footer logo missing/);
});
test('503, wrong MIME and absent social metadata fail read-only observation',async()=>{
  const html=routes.get('/').toString('utf8').replace('name="twitter:card"','name="another:card"');
  const result=await observeBranding(fixture({
    '/':response(html,'text/html'),
    '/verification/':response('service unavailable','text/plain',503),
    '/assets/atto-social-preview.png':response(images.get('/assets/atto-social-preview.png'),'text/plain')
  }));
  assert.equal(result.all_visible,false);
  assert.match(result.findings.join(';'),/HTTP 503/);
  assert.match(result.findings.join(';'),/twitter:card/);
  assert.match(result.findings.join(';'),/unexpected MIME/);
});
test('wrong origin is rejected before any network activity',async()=>{
  let calls=0;
  await assert.rejects(observeBranding({origin:'https://attacker.invalid',
    fetchImpl:()=>{calls++;throw Error('network attempted')}}),/Wrong public origin/);
  assert.equal(calls,0);
});
