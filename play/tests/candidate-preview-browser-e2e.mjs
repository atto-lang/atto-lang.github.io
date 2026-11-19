#!/usr/bin/env node
// Private-only focused real-Chromium candidate test. Original release E2E gates
// remain unmodified and must pass separately before ANY public promotion.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,stat,mkdtemp,rm} from 'node:fs/promises';
import {resolve,extname,sep,join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';

// This entrypoint is intentionally omitted from public npm test and browser E2E.
// It runs ONLY with a separately verified compiler candidate in an isolated
// private checkout. Never replace the checked-in public compiler just to run it.
if(process.env.ATTO_VERIFY_PRIVATE_PREVIEWS!=='1')throw new Error('Private candidate opt-in required');
const compilerHead=process.env.ATTO_PRIVATE_COMPILER_HEAD;
const siteHead=process.env.ATTO_PRIVATE_SITE_HEAD;
assert.match(compilerHead||'',/^[a-f0-9]{40}$/);
assert.match(siteHead||'',/^[a-f0-9]{40}$/);
const root=resolve(new URL('..',import.meta.url).pathname);
const site=resolve(root,'..');
const receipt=JSON.parse(await readFile(join(root,'public/atto_compiler.receipt.json'),'utf8'));
const candidateBytes=await readFile(join(root,'public/atto_compiler.wasm'));
assert.equal(receipt.source_head,compilerHead,'only the explicitly verified compiler head is admissible');
assert.equal(receipt.compiler_sha256,createHash('sha256').update(candidateBytes).digest('hex'));
assert.equal(receipt.compiler_bytes,candidateBytes.byteLength);
assert.ok(candidateBytes.byteLength > 0 && candidateBytes.byteLength <= 1024*1024,
  'Unreleased candidate compiler exceeds the 1 MiB size limit in verify-compiler-candidate.mjs');
assert.equal(receipt.compiler_abi,2);
assert.equal(receipt.guest_abi,'atto.browser.guest.v2');
assert.ok(WebAssembly.validate(candidateBytes));
assert.equal(execFileSync('git',['-C',site,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),siteHead,'site tree must be exact reviewed checkout');
const mime={'.html':'text/html','.js':'text/javascript; charset=utf-8','.css':'text/css','.wasm':'application/wasm'};
const served=[];
const server=createServer(async(req,res)=>{
 served.push({method:req.method,url:req.url});
 try{
  let name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  if(!name.startsWith('/play/'))throw new Error('not playground');
  name=name.slice('/play/'.length)||'index.html';
  if(name.endsWith('/'))name+='index.html';
  const file=resolve(root,name);
  if(!file.startsWith(root+sep)||!(await stat(file)).isFile())throw new Error('not a regular asset');
  res.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream','Cache-Control':'no-store'});
  res.end(await readFile(file));
 }catch{res.writeHead(404);res.end('Not found');}
});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function poll(fn,label,attempts=150){
 let last;
 for(let i=0;i<attempts;i++){try{const x=await fn();if(x)return x;last=x}catch(e){last=e.message}await sleep(90)}
 throw new Error(label+' timed out: '+JSON.stringify(last));
}
async function deadline(promise,ms){
 let t;try{return await Promise.race([promise,new Promise((_,reject)=>{t=setTimeout(()=>reject(new Error('CDP timeout')),ms)})])}
 finally{clearTimeout(t)}
}
const profile=await mkdtemp(join(tmpdir(),'atto-candidate-browser-'));
let chrome,socket,open=false,passes=0;
const pass=label=>{passes++;console.log('PASS_PRIVATE_CHROMIUM '+passes+' '+label)};
try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));open=true;
 const base='http://127.0.0.1:'+server.address().port+'/play/';
 chrome=spawn(process.env.CHROME_BIN||'google-chrome',[
  '--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-gpu',
  '--disable-background-networking','--no-first-run','--no-proxy-server',
  '--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'
 ],{stdio:['ignore','ignore','pipe']});
 let errors='';
 chrome.stderr.on('data',v=>{errors=(errors+v.toString()).slice(-3000)});
 chrome.on('error',e=>{errors+=String(e)});
 const port=await poll(async()=>{
  if(chrome.exitCode!==null)throw new Error('Chrome exited: '+errors);
  try{const x=Number((await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);return x>0?x:null}catch{return null}
 },'Chromium debug port',220);
 const pages=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();
 const page=pages.find(x=>x.type==='page'&&x.webSocketDebuggerUrl);
 assert.ok(page,'No debuggable Chromium page');
 socket=new WebSocket(page.webSocketDebuggerUrl);
 await deadline(new Promise((ok,no)=>{socket.addEventListener('open',ok,{once:true});socket.addEventListener('error',no,{once:true})}),6000);
 let id=0;const pending=new Map();
 socket.addEventListener('message',event=>{
  const m=JSON.parse(event.data);if(!pending.has(m.id))return;
  const x=pending.get(m.id);pending.delete(m.id);m.error?x.reject(new Error(m.error.message)):x.resolve(m.result)
 });
 const cdp=(method,params={})=>deadline(new Promise((ok,no)=>{
  const n=++id;pending.set(n,{resolve:ok,reject:no});
  socket.send(JSON.stringify({id:n,method,params}))
 }),8000);
 const js=async code=>{
  const r=await cdp('Runtime.evaluate',{expression:code,returnByValue:true,awaitPromise:true});
  if(r.exceptionDetails)throw new Error(r.exceptionDetails.text);
  return r.result?.value
 };
 const snap="(()=>{const q=x=>document.querySelector(x);return {loaded:!!q('#source'),source:q('#source')?.value,kind:q('#summary')?.dataset.kind,output:q('#output')?.textContent,diagnostics:q('#diagnostics')?.textContent,bytes:q('#bytes')?.textContent,runDisabled:q('#run')?.disabled,compileDisabled:q('#compile')?.disabled,downloadDisabled:q('#download')?.disabled}})()";
 const view=()=>js(snap);
 const click=name=>js('document.querySelector('+JSON.stringify('#'+name)+').click()');
 await cdp('Page.enable');await cdp('Runtime.enable');
 const nav=await cdp('Page.navigate',{url:base});
 assert.ok(!nav?.errorText,'Browser navigation: '+nav?.errorText);
 await poll(async()=>{const v=await view();return v?.loaded&&v.source?.includes('fnc main')?v:null},'Site initial UI');
 pass('site runs from private temporary checkout');
 async function example(name){
  const code="(async()=>{const input=document.querySelector('#source');const done=new Promise(resolve=>input.addEventListener('input',resolve,{once:true}));const sel=document.querySelector('#example');sel.value="+JSON.stringify(name)+";if(sel.value!=="+JSON.stringify(name)+")throw new Error('Missing example');sel.dispatchEvent(new Event('change',{bubbles:true}));await done;return sel.value;})()";
  assert.equal(await js(code),name);
 }
 async function run(name,value,stdout){
  await example(name);
  if(name==='classes')assert.match((await view()).source,/final int id;/);
  await click('compile');
  const compiled=await poll(async()=>{const s=await view();return !s.compileDisabled&&s.kind==='success'&&/\d+ bytes/.test(s.bytes)?s:null},name+' compile');
  assert.equal(compiled.downloadDisabled,false,name+' compiled artifact');
  await click('run');
  const result=await poll(async()=>{const s=await view();return !s.runDisabled&&s.kind==='success'&&s.output?.includes('main() → '+value)?s:null},name+' execution',220);
  assert.ok(result.output.startsWith(stdout),name+' stdout: '+result.output);
  pass(name+' authentic guest compile+execute '+value);
 }
 await run('classes','42','Account{id=7, balance=100}\n125\n');
 await run('enums','7','green after 7 changes\n');
 await run('actors','0','main sent 5 messages\n1\n3\n6\n10\n15\n');
 await run("preview/generators","10",'10\n');
 await run("preview/closures-functors","84",'');
 await run("preview/borrow-checking","63",'84\n43\n');
 await run("preview/fib-match","144",'0 1 1 2 3 5 8 13 21 34 \n');
 await run("preview/function-pipeline","121",'121\n');
 await run("preview/trap","7",'5\nid must be nonnegative\nan ordinary throw was caught\n');
 assert.ok(served.every(r=>r.method==='GET'),'Only static GETs allowed');
 assert.ok(served.some(r=>r.url.includes('/play/public/atto_compiler.wasm')),'Compiler delivered as static Wasm');
 pass('static-only site; no source POST');
 console.log('PRIVATE_CHROMIUM_CANDIDATE_RESULT',JSON.stringify({passed:passes,site_sha:siteHead,published:false,preview_release_gates:'NOT_SATISFIED'}));
}finally{
 try{socket?.close()}catch{}
 if(chrome&&chrome.exitCode===null){
  const closed=new Promise(resolve=>chrome.once('close',resolve));chrome.kill('SIGKILL');
  await deadline(closed,4000).catch(()=>{});
 }
 if(open)await new Promise(resolve=>server.close(resolve));
 await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:100});
}
