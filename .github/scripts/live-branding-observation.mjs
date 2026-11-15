/**
 * A separate, read-only website branding observation: NOT a compiler release
 * certificate and NOT a declaration about Pages governance.
 */
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

export const ORIGIN='https://atto-lang.github.io';
export const ROUTES=Object.freeze([
  {url:'/',source:'index.html',head:'./assets/atto-logo.svg',foot:'./assets/atto-mark.svg'},
  {url:'/play/',source:'play/index.html',head:'/assets/atto-mark.svg',foot:'/assets/atto-mark.svg'},
  {url:'/whitepapers/',source:'whitepapers/index.html',head:'/assets/atto-mark.svg',foot:'/assets/atto-mark.svg'},
  {url:'/whitepapers/01-language-design.html',source:'_layouts/whitepaper.html',head:'/assets/atto-mark.svg',foot:'/assets/atto-mark.svg'},
  {url:'/play/architecture/',source:'play/architecture/index.html',head:'/assets/atto-mark.svg',foot:'/assets/atto-mark.svg'}
  // verification/ is a source-only dashboard excluded from Pages by _config.yml.
]);
export const IMAGES=Object.freeze([
  'assets/atto-logo.svg','assets/atto-mark.svg',
  'assets/favicon-32x32.png','assets/apple-touch-icon.png','assets/atto-social-preview.png'
]);
const digest=b=>createHash('sha256').update(b).digest('hex');
const type=r=>(r.headers?.get?.('content-type')||'').split(';',1)[0].trim().toLowerCase();
async function bounded(response,limit,path){
  const length=response.headers?.get?.('content-length');
  const encoding=(response.headers?.get?.('content-encoding')||'').trim().toLowerCase();
  if(encoding&&!['identity','gzip','br','deflate'].includes(encoding))throw Error('unsupported encoding '+path);
  if(length!=null&&(!/^(0|[1-9][0-9]*)$/.test(length.trim())||
     !Number.isSafeInteger(Number(length))||Number(length)>limit))throw Error('invalid content length '+path);
  const reader=response.body?.getReader?.();
  if(!reader)throw Error('missing response body '+path);
  const parts=[];let n=0;
  try {
    while(true){
      const {done,value}=await reader.read();if(done)break;
      if(!(value instanceof Uint8Array))throw Error('malformed response '+path);
      n+=value.length;if(n>limit)throw Error('oversized response '+path);
      parts.push(value);
    }
    if(!['gzip','br','deflate'].includes(encoding)&&length!=null&&Number(length)!==n)
      throw Error('incorrect content length '+path);
  }catch(error){await reader.cancel().catch(()=>{});throw error}
  finally{reader.releaseLock()}
  return Buffer.concat(parts,n);
}
export function htmlFindings(html,route){
  const problems=[];
  const header=html.match(/<(?:header|aside)\b[^>]*>[\s\S]*?<\/(?:header|aside)>/i)?.[0]||'';
  const footer=html.match(/<footer\b[^>]*>[\s\S]*?<\/footer>/i)?.[0]||'';
  if(!header.includes('src="'+route.head+'"'))problems.push('header logo missing');
  if(!footer.includes('src="'+route.foot+'"'))problems.push('footer logo missing');
  for(const marker of ['favicon-32x32.png','apple-touch-icon.png','atto-social-preview.png','name="twitter:card"']){
    if(!html.includes(marker))problems.push('missing '+marker);
  }
  return problems.map(problem=>route.url+': '+problem);
}
export async function observeBranding({fetchImpl=fetch,origin=ORIGIN}={}){
  if(origin!==ORIGIN)throw Error('Wrong public origin');
  const observations=[],findings=[];
  async function get(path){
    const r=await fetchImpl(origin+path,{
      method:'GET',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000)
    });
    if(!r||r.redirected||!Number.isInteger(r.status))throw Error('invalid response '+path);
    return r;
  }
  for(const name of IMAGES){
    const path='/'+name;
    try {
      const expected=await readFile(new URL('../../'+name,import.meta.url));
      const response=await get(path);
      const mime=name.endsWith('.png')?'image/png':'image/svg+xml';
      if(response.status!==200||type(response)!==mime)
        throw Error('HTTP '+response.status+' or unexpected MIME');
      const bytes=await bounded(response,expected.length,path);
      if(bytes.length!==expected.length||digest(bytes)!==digest(expected))
        throw Error('live image differs from approved source');
      observations.push({path,bytes:bytes.length,sha256:digest(bytes)});
    }catch(e){findings.push(path+': '+e.message)}
  }
  for(const route of ROUTES){
    try{
      const response=await get(route.url);
      if(response.status!==200||type(response)!=='text/html')
        throw Error('HTTP '+response.status+' or unexpected HTML MIME');
      const bytes=await bounded(response,512*1024,route.url);
      findings.push(...htmlFindings(bytes.toString('utf8'),route));
      observations.push({path:route.url,bytes:bytes.length});
    }catch(e){findings.push(route.url+': '+e.message)}
  }
  return Object.freeze({
    status:'BRANDING_OBSERVATION_ONLY_NOT_RELEASE_APPROVAL',
    all_visible:findings.length===0,
    checked_assets:IMAGES.length,checked_routes:ROUTES.length,
    observations,findings
  });
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  observeBranding().then(result=>{
    console.log(JSON.stringify(result,null,2));
    if(!result.all_visible)process.exitCode=1;
  }).catch(e=>{console.error('BRANDING_NOT_OBSERVED: '+e.message);process.exitCode=1});
}
