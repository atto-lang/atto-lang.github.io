import { actorProgramFixture, scalarV0ActorFixture, actorStressFixture, startSectionWasmFixture, resourceWasmFixture } from './actor-fixture.mjs';
/** Chromium end-to-end tests using real browser controls and actual WebAssembly.
 * No Playwright package needed; only Node 22 and a Chromium executable.
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, readdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { join, resolve, sep, extname } from 'node:path';
import { tmpdir } from 'node:os';

const root = process.env.ATTO_STATIC_ROOT ? resolve(process.env.ATTO_STATIC_ROOT) : resolve(new URL('..', import.meta.url).pathname);
const mime = { '.html':'text/html', '.css':'text/css', '.js':'text/javascript', '.wasm':'application/wasm', '.md':'text/plain' };
const requests = [];
const server = createServer(async (req, res) => {
  requests.push({method:req.method, url:req.url});
  try {
    const parsed = new URL(req.url, 'http://localhost');
    let name = decodeURIComponent(parsed.pathname);
    if (!name.startsWith('/play/')) throw new Error('outside playground');
    name = name.slice('/play/'.length) || 'index.html';
    const file = resolve(root, name);
    if (!file.startsWith(root + sep) || !(await stat(file)).isFile()) throw new Error('non-file');
    res.writeHead(200, {'Content-Type':mime[extname(file)]||'application/octet-stream','X-Content-Type-Options':'nosniff','Cache-Control':'no-store'});
    res.end(await readFile(file));
  } catch {res.writeHead(404);res.end('Not found');}
});
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function poll(fn, label, attempts=160) {
  let last;
  for (let i=0;i<attempts;i++) {
    try {const result=await fn(); if(result) return result; last=result;}
    catch(e) {last=e.message;}
    await sleep(80);
  }
  throw new Error(label+' timed out: '+JSON.stringify(last));
}
async function deadline(promise, ms) {
  let timer;
  try {return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('CDP deadline exceeded')),ms);})]);}
  finally {clearTimeout(timer);}
}
const profile=await mkdtemp(join(tmpdir(),'atto-e2e-profile-'));
const downloads=await mkdtemp(join(tmpdir(),'atto-e2e-download-'));
let chrome, socket, listening=false;
let passed=0;
function ok(label) {passed++;console.log('PASS E2E '+passed+': '+label);}
try {
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  listening=true;
  const base='http://127.0.0.1:'+server.address().port+'/play/';
  chrome=spawn(process.env.CHROME_BIN||'chromium',[
    '--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-gpu',
    '--disable-background-networking','--no-first-run','--no-proxy-server',
    '--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'
  ],{stdio:['ignore','ignore','pipe']});
  let chromeErrors='';
  chrome.stderr.on('data',chunk=>{chromeErrors=(chromeErrors+chunk.toString()).slice(-4000);});
  chrome.on('error',error=>{chromeErrors+=error.message;});
  const port=await poll(async()=>{
    if(chrome.exitCode!==null)throw new Error(chromeErrors);
    try {const n=Number((await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);return n>0?n:null;}
    catch{return null;}
  },'Chromium debug port',250);
  const pages=await (await fetch('http://127.0.0.1:'+port+'/json/list')).json();
  const page=pages.find(item=>item.type==='page'&&item.webSocketDebuggerUrl);
  assert.ok(page,'Chromium page target missing');
  socket=new WebSocket(page.webSocketDebuggerUrl);
  await deadline(new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});}),5000);
  let id=0;const pending=new Map();
  socket.addEventListener('message',event=>{
    const message=JSON.parse(event.data);
    if(!pending.has(message.id))return;
    const pair=pending.get(message.id);pending.delete(message.id);
    if(message.error)pair.reject(new Error(message.error.message));else pair.resolve(message.result);
  });
  function cdp(method,params={}) {
    return deadline(new Promise((resolve,reject)=>{
      const next=++id;pending.set(next,{resolve,reject});
      socket.send(JSON.stringify({id:next,method,params}));
    }),6000);
  }
  async function js(expression) {
    const r=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
    if(r.exceptionDetails)throw new Error(r.exceptionDetails.text);
    return r.result?.value;
  }
  const snapshot="(()=>{const q=x=>document.querySelector(x);return {loaded:!!q('#source'),source:q('#source')?.value,kind:q('#summary')?.dataset.kind,output:q('#output')?.textContent,diagnostics:q('#diagnostics')?.textContent,bytes:q('#bytes')?.textContent,downloadDisabled:q('#download')?.disabled,runDisabled:q('#run')?.disabled,stopDisabled:q('#stop')?.disabled,hash:location.hash,injected:window.__attoInjected===true};})()";
  const view=()=>js(snapshot);
  async function navigate(url) {
    const result=await cdp('Page.navigate',{url});
    assert.ok(!result.errorText,'Navigation failed: '+result.errorText);
    return poll(async()=>{const s=await view();return s?.loaded&&s.source?.includes('fnc main')?s:null;},'DOM navigation');
  }
  const click=id=>js("document.querySelector("+JSON.stringify('#'+id)+").click()");
  const source=text=>js("(()=>{const e=document.querySelector('#source');e.value="+JSON.stringify(text)+";e.dispatchEvent(new Event('input',{bubbles:true}));})()");
  // examples are fetched .atto files, so wait for the editor to be replaced
  const example=async name=>{
    await js("(()=>{const e=document.querySelector('#example');e.value="+JSON.stringify(name)+";e.dispatchEvent(new Event('change',{bubbles:true}));})()");
    await poll(async()=>(await view())?.output?.includes('Source changed'),'example '+name+' loaded');
  };
  async function run(kind,expected) {
    await click('run');
    return poll(async()=>{
      const s=await view();
      return !s?.runDisabled&&s.kind===kind&&(s.output?.includes(expected)||s.diagnostics?.includes(expected))?s:null;
    },'Run '+kind+' '+expected);
  }
  await cdp('Page.enable');
  await cdp('Runtime.enable');
  await cdp('Page.setDownloadBehavior',{behavior:'allow',downloadPath:downloads});
  await navigate(base);
  ok('static site resolves under /play/');

  const unformatted='fnc main() -> int {\nreturn 42;\n}\n';
  await source(unformatted);
  await click('check-format');
  await poll(async()=> (await js("document.querySelector('#status').textContent"))?.includes('Formatting differs'), 'format check (no mutation)');
  assert.equal((await view()).source,unformatted);
  await click('format');
  const formatted=await poll(async()=>{const s=await view();return s.source?.includes('\n  return 42;\n')?s:null;},'real formatter in browser worker');
  assert.equal(formatted.source.includes('\n  return 42;\n'),true);
  assert.equal(await js("document.querySelector('#syntax-layer').textContent"),formatted.source);
  await click('format');
  await poll(async()=> (await js("document.querySelector('#status').textContent"))?.includes('Already canonically formatted'),'format idempotence');
  assert.equal((await view()).source,formatted.source);
  await run('success','main() → 42');
  ok('canonical Rust formatter executes in browser worker; check is nonmutating, format idempotent and compiler still works');
  const malformed='fnc identity(int x) -> int do return x; end\n';
  await source(malformed);
  await click('format');
  await poll(async()=> (await js("document.querySelector('#status').textContent"))?.includes('Formatter rejected source'),'formatter failure');
  assert.equal((await view()).source,malformed);
  ok('formatter rejects invalid syntax without overwriting edited source');
  await example('hello');

  // Custom program library and syntax mirror, both on the real static origin.
  const customSource='fnc main() -> int { return 20 + 22; }';
  await js("(()=>{const e=document.querySelector('#example');e.value='custom:new';e.dispatchEvent(new Event('change',{bubbles:true}));})()");
  await source(customSource);
  await js("(()=>{document.querySelector('#program-name').value='Demo 42';document.querySelector('#save-custom').click()})()");
  const saved=await js("(()=>{const x=JSON.parse(localStorage.getItem('atto.playground.saved-programs.v1'));return {name:x?.[0]?.name,source:x?.[0]?.source,selected:document.querySelector('#example').value}})()");
  assert.deepEqual(saved,{name:'Demo 42',source:customSource,selected:'saved:Demo 42'});
  assert.equal(await js("document.querySelector('#syntax-layer .tok-keyword')?.textContent"),'fnc');
  assert.equal(await js("document.querySelector('#syntax-layer').textContent"),customSource);
  ok('custom + saves a named program in browser localStorage with syntax coloring');
  await example('primes');
  await js("(()=>{const e=document.querySelector('#example');e.value='saved:Demo 42';e.dispatchEvent(new Event('change',{bubbles:true}));})()");
  assert.equal((await view()).source,customSource);
  await run('success','main() → 42');
  ok('saved program reloads from the custom dropdown and compiles in real Wasm');
  await cdp('Page.navigate',{url:'about:blank'});
  await navigate(base);
  await js("(()=>{const e=document.querySelector('#example');e.value='saved:Demo 42';e.dispatchEvent(new Event('change',{bubbles:true}));})()");
  assert.equal((await view()).source,customSource);
  await example('hello');
  await source('// <img src=x onerror="window.__attoInjected=true">\nfnc main() -> int { return 42; }');
  assert.equal(await js("document.querySelector('#syntax-layer img')!==null"),false);
  assert.equal(await js("document.querySelector('#syntax-layer').textContent"),
    '// <img src=x onerror="window.__attoInjected=true">\nfnc main() -> int { return 42; }');
  assert.equal((await view()).injected,false);
  ok('programs persist after navigation, and highlighted source is never executable HTML');
  await example('hello');
  let s=await run('success','main() → 42');
  assert.match(s.output,/^Hello from WebAssembly!\n42\nmain\(\) → 42/);
  assert.match(s.bytes,/^\d+ bytes$/);
  assert.equal(s.downloadDisabled,false);
  ok('real Run control compiles Atto into Wasm and executes 42');
  assert.equal(await js("document.querySelector('#tab-console').getAttribute('aria-selected')"), 'true');
  await click('tab-wasm');
  const preview=await js("document.querySelector('#wasm-preview').textContent");
  assert.match(preview,/WebAssembly binary\nSize: \d+ bytes\nHeader and first \d+ bytes:\n00 61 73 6d/);
  assert.equal(await js("document.querySelector('#panel-console').hidden"),true);
  await click('tab-console');
  ok('accessible tabs expose a bounded Wasm hex preview without replacing the console');
  await click('download');
  const wasm=await poll(async()=>{
    const files=(await readdir(downloads)).filter(n=>n.endsWith('.wasm'));
    if(!files.length)return null;
    const bytes=await readFile(join(downloads,files[0]));
    return WebAssembly.validate(bytes)?bytes:null;
  },'downloaded binary');
  const printed=[];
  const atto={print_i64:v=>printed.push(String(v)),print_bool:v=>printed.push(String(!!v)),print_str:()=>printed.push('str'),print_newline:()=>{}};
  assert.equal((await WebAssembly.instantiate(wasm,{atto})).instance.exports.main(),42n);
  assert.deepEqual(printed,['str','42']);
  ok('downloaded real guest Wasm validates and executes');
  await source('fnc main() -> int { return 17 + 8; }');
  s=await view();
  assert.equal(s.bytes,'—');
  assert.equal(s.downloadDisabled,true);
  await run('success','main() → 25');
  ok('editing invalidates old download and changes guest result');
  await example('primes');
  s=await run('success','main() → 10');
  assert.match(s.output,/^2\n3\n5\n7\n11\n13\n17\n19\n23\n29\nmain\(\) → 10/);
  ok('loops example executes with stdout');
  await example('error');
  s=await run('error','E_IMMUTABLE');
  assert.equal(s.bytes,'—');assert.equal(s.downloadDisabled,true);
  ok('immutable reassignment rejected without output artifact');
  assert.equal(await js("document.querySelector('#tab-diagnostics').getAttribute('aria-selected')"),'true');
  assert.equal(await js("document.querySelector('#diagnostics button')?.tagName"),'BUTTON');
  await js("document.querySelector('#diagnostics button').click()");
  assert.equal(await js("document.activeElement?.id"),'source');
  ok('compiler errors switch to Diagnostics and jump to the native editor');
  await source('fnc main() -> int { return 2 + ; }');
  s=await run('error','E_SYNTAX');
  assert.equal(s.downloadDisabled,true);
  ok('syntax error rejected in UI');
  await source('fnc zero(): int { return 0; }\nfnc main() -> int { return 42 % zero(); }');
  s=await run('error','E_PANIC: division by zero');
  assert.match(s.bytes,/^\d+ bytes$/);
  ok('runtime panic distinguished from compile error');
  await example('overflow');
  s=await run('error','E_PANIC: integer overflow');
  assert.match(s.output,/4611686018427387904\nE_PANIC: integer overflow/);
  ok('checked int overflow panics and keeps earlier output');
  await source('fnc main() -> int { loop { } }');
  s=await run('error','deadline');
  ok('infinite loop is stopped by the worker deadline');
  await source('fnc main() -> int { return 42; }'+' '.repeat(70000));
  s=await run('error','E_SOURCE_LIMIT');
  assert.equal(s.downloadDisabled,true);
  ok('oversized source fails closed');
  await source('fnc main() -> int { return 6 * 7; }');
  await run('success','main() → 42');
  ok('recovery from syntax and runtime errors');
  await source('fnc main() -> int {\n  return 41;\n}');
  await js("(()=>{const e=document.querySelector('#source');e.focus();e.setSelectionRange(e.value.indexOf('return'),e.value.indexOf('return'));e.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));})()");
  assert.match((await view()).source,/\n    return 41;/);
  await js("document.querySelector('#source').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',ctrlKey:true,bubbles:true,cancelable:true}))");
  s=await poll(async()=>{const x=await view();return x?.kind==='success'&&x.output?.includes('main() → 41')&&!x.runDisabled?x:null;},'keyboard shortcut Run');
  ok('Tab indents and Ctrl+Enter invokes the real compiler and runtime');
  const shared='// 🚀 文字\nfnc main() -> int { return 29 + 13; }';
  await source(shared);
  await click('share');
  const hash=await poll(async()=>{const x=(await view()).hash;return x.startsWith('#code=')?x:null;},'share link');
  await cdp('Page.navigate',{url:'about:blank'});
  await navigate(base+hash);
  assert.equal((await view()).source,shared);
  await run('success','main() → 42');
  ok('share URL preserves Unicode source across full reload');
  await source('fnc main() -> int { return 41; }');
  await js("(()=>{document.querySelector('#run').click();document.querySelector('#stop').click();})()");
  s=await view();
  assert.match(s.output,/cancelled/i);
  assert.equal(s.stopDisabled,true);
  await run('success','main() → 41');
  await sleep(3300);
  s=await view();
  assert.equal(s.kind,'success');
  assert.match(s.output,/main\(\) → 41/);
  ok('Stop cancels request and stale completion cannot clobber new run');
  await source('<img src=x onerror="window.__attoInjected=true">');
  s=await run('error','E_TOPLEVEL');
  assert.equal(s.injected,false);
  ok('HTML injection input rejected and not executed');
  // A real Wasm main guest spawns two nested Workers with independent
  // mutable globals. This fixture is deliberately source-free: do not
  // mistake the passing host test for public class/enum/actor compilation.
  const actorGuest = Buffer.from(actorProgramFixture()).toString('base64');
  const workerResult = await js("(async()=>{const bytes=Uint8Array.from(atob("+
    JSON.stringify(actorGuest)+"),c=>c.charCodeAt(0));"+
    "const worker=new Worker('./src/runner-worker.js',{type:'module'});"+
    "try{return await new Promise((resolve,reject)=>{"+
    "const deadline=setTimeout(()=>reject(Error('actor fixture worker timeout')),5000);"+
    "worker.onmessage=e=>{clearTimeout(deadline);resolve(e.data)};"+
    "worker.onerror=e=>{clearTimeout(deadline);reject(Error('actor worker error'))};"+
    "worker.postMessage({wasm:bytes})})}finally{worker.terminate()}})()");
  assert.equal(workerResult.ok, true, JSON.stringify(workerResult));
  assert.equal(workerResult.value, '42');
  assert.equal(workerResult.stdout,
    'actor[1] receive(41) -> 42\nactor[2] receive(41) -> 42\n');
  assert.ok(requests.some(r=>r.url.includes('/play/src/actor-guest-worker.js')),
    'browser must load genuine nested worker module');
  ok('two nested Web Workers use separate mutable Wasm globals and acknowledged close');
  // A deliberately valid standalone scalar.v0 module must be rejected by
  // both integrated.v1 entry points, before worker guest code is executed.
  const scalarV0 = Buffer.from(scalarV0ActorFixture()).toString('base64');
  const rejectedV0 = await js("(async()=>{const bytes=Uint8Array.from(atob("+
    JSON.stringify(scalarV0)+"),c=>c.charCodeAt(0));"+
    "async function attempt(path,packet){"+
    "const w=new Worker(path,{type:'module'});"+
    "try{return await new Promise((resolve,reject)=>{"+
    "const timer=setTimeout(()=>reject(Error('ABI mismatch deadline')),5000);"+
    "w.onmessage=e=>{clearTimeout(timer);resolve(e.data)};"+
    "w.onerror=e=>{clearTimeout(timer);reject(Error('ABI mismatch worker error'))};"+
    "w.postMessage(packet)})}finally{w.terminate()}}"+
    "return {parent:await attempt('./src/runner-worker.js',{wasm:bytes}),"+
    "child:await attempt('./src/actor-guest-worker.js',{kind:'init',actorId:0,version:1,wasm:bytes})}})()");
  assert.equal(rejectedV0.parent.ok,false);
  assert.match(rejectedV0.parent.message,/E_ACTOR_ABI_MISMATCH/);
  assert.deepEqual(rejectedV0.child,{kind:'error',message:'E_ACTOR_ABI_MISMATCH'});
  ok('valid standalone scalar.v0 Wasm rejected by both integrated.v1 Web Worker entrypoints');
  // Send an accepted message and then replay its sequence to the *real*
  // actor guest worker. Reject without running receive a second time.
  const replayProbe = await js("(async()=>{const bytes=Uint8Array.from(atob("+
    JSON.stringify(actorGuest)+"),c=>c.charCodeAt(0));"+
    "const w=new Worker('./src/actor-guest-worker.js',{type:'module'});"+
    "try{return await new Promise((resolve,reject)=>{"+
    "const events=[];const deadline=setTimeout(()=>reject(Error('replay worker deadline')),5000);"+
    "w.onerror=e=>{clearTimeout(deadline);reject(Error('replay worker error'))};"+
    "w.onmessage=e=>{events.push(e.data);"+
    "if(e.data.kind==='ready')w.postMessage({kind:'message',actorId:0,seq:1,value:41n});"+
    "else if(e.data.kind==='reply')w.postMessage({kind:'message',actorId:0,seq:1,value:41n});"+
    "else if(e.data.kind==='error'){clearTimeout(deadline);resolve(events.map(x=>({...x,value:typeof x.value==='bigint'?x.value.toString():x.value})))}};"+
    "w.postMessage({kind:'init',actorId:0,version:1,wasm:bytes})})"+
    "}finally{w.terminate()}})()");
  assert.deepEqual(replayProbe.map(x=>x.kind),['ready','reply','error']);
  assert.equal(replayProbe[1].seq,1);
  assert.equal(replayProbe[1].value,'42');
  assert.equal(replayProbe[2].message,'E_ACTOR_SEQUENCE');
  ok('real nested actor worker rejects replayed message sequence without second reply');

  // Host and child work against real Wasm with four independent actor globals.
  // Each of four mailboxes accepts exactly 32 messages and rejects message 33.
  const stressBytes=Buffer.from(actorStressFixture()).toString('base64');
  const stressResult=await js("(async()=>{const bytes=Uint8Array.from(atob("+
    JSON.stringify(stressBytes)+"),c=>c.charCodeAt(0));"+
    "const w=new Worker('./src/runner-worker.js',{type:'module'});"+
    "try{return await new Promise((resolve,reject)=>{"+
    "const timer=setTimeout(()=>reject(Error('actor saturation timeout')),8000);"+
    "w.onmessage=e=>{clearTimeout(timer);resolve(e.data)};"+
    "w.onerror=e=>{clearTimeout(timer);reject(Error('actor saturation worker error'))};"+
    "w.postMessage({wasm:bytes})})}finally{w.terminate()}})()");
  assert.equal(stressResult.ok,true,JSON.stringify(stressResult));
  assert.equal(stressResult.value,'42','all four 33rd sends must report FULL');
  const stressLines=stressResult.stdout.trimEnd().split('\n');
  assert.equal(stressLines.length,128,'exactly 128 accepted receives');
  for(let a=1;a<=4;a++)for(let i=0;i<32;i++) {
    assert.equal(stressLines[(a-1)*32+i],
      'actor['+a+'] receive('+i+') -> '+(2*i+1));
  }
  assert.ok(!stressResult.stdout.includes('receive(32)'));
  ok('four Web Workers, 128 FIFO receives and four rejected 33rd sends');

  // A fifth actor is over budget. It must fail before executing any receive.
  const fifthBytes=Buffer.from(actorStressFixture({actorCount:5,messagesPerActor:1})).toString('base64');
  const fifth=await js("(async()=>{const bytes=Uint8Array.from(atob("+
    JSON.stringify(fifthBytes)+"),c=>c.charCodeAt(0));"+
    "const w=new Worker('./src/runner-worker.js',{type:'module'});"+
    "try{return await new Promise((resolve,reject)=>{"+
    "const timer=setTimeout(()=>reject(Error('fifth actor timeout')),5000);"+
    "w.onmessage=e=>{clearTimeout(timer);resolve(e.data)};"+
    "w.onerror=e=>{clearTimeout(timer);reject(Error('fifth actor worker error'))};"+
    "w.postMessage({wasm:bytes})})}finally{w.terminate()}})()");
  assert.equal(fifth.ok,false);
  assert.match(fifth.message,/E_ACTOR_LIMIT_OR_ID/);
  assert.equal(fifth.stdout,'');
  ok('fifth actor rejected before messages execute');

  // Reusing a parent worker must not start a second program/actor namespace.
  const reuse=await js("(async()=>{const bytes=Uint8Array.from(atob("+
    JSON.stringify(actorGuest)+"),c=>c.charCodeAt(0));"+
    "const w=new Worker('./src/runner-worker.js',{type:'module'});"+
    "try{return await new Promise((resolve,reject)=>{"+
    "const got=[];const timer=setTimeout(()=>reject(Error('runner reuse timeout')),6000);"+
    "w.onmessage=e=>{got.push(e.data);if(got.length===2){clearTimeout(timer);resolve(got)}};"+
    "w.onerror=e=>{clearTimeout(timer);reject(Error('runner reuse worker error'))};"+
    "w.postMessage({wasm:bytes});w.postMessage({wasm:bytes})})}finally{w.terminate()}})()");
  assert.equal(reuse.filter(x=>x.ok).length,1);
  assert.equal(reuse.filter(x=>!x.ok&&x.message==='E_RUNNER_REUSED').length,1);
  ok('runner rejects reentrant program startup');

  // Reject hostile non-typed payloads and an oversized module before copying
  // its bytes or constructing a WebAssembly.Module.
  const malformedRunner=await js("(async()=>{const bad=[{wasm:{untrusted:true}},{wasm:new Uint8Array(1048577)}];"+
    "const results=[];for(const packet of bad){"+
    "const w=new Worker('./src/runner-worker.js',{type:'module'});"+
    "try{results.push(await new Promise((resolve,reject)=>{"+
    "const timer=setTimeout(()=>reject(Error('malformed runner timeout')),5000);"+
    "w.onmessage=e=>{clearTimeout(timer);resolve(e.data)};"+
    "w.onerror=e=>{clearTimeout(timer);reject(Error('malformed runner worker error'))};"+
    "w.postMessage(packet)}))}finally{w.terminate()}}return results})()");
  assert.equal(malformedRunner.length,2);
  for(const result of malformedRunner){
    assert.equal(result.ok,false);
    assert.match(result.message,/E_GUEST_WASM/);
  }
  ok('malformed and oversized Wasm rejected before guest allocation');

  // WebAssembly validates start functions, but they execute during
  // instantiation before the host invokes main()/receive(). Both independent
  // execution domains must reject valid modules with start sections.
  const startBytes=Buffer.from(startSectionWasmFixture()).toString('base64');
  const hardened=await js("(async()=>{const start=Uint8Array.from(atob("+
    JSON.stringify(startBytes)+"),c=>c.charCodeAt(0));"+
    "async function attempt(path,packet){const w=new Worker(path,{type:'module'});"+
    "try{return await new Promise((resolve,reject)=>{"+
    "const deadline=setTimeout(()=>reject(Error('guest validation deadline')),5000);"+
    "w.onmessage=e=>{clearTimeout(deadline);resolve(e.data)};"+
    "w.onerror=e=>{clearTimeout(deadline);reject(Error('guest validation worker error'))};"+
    "w.postMessage(packet)})}finally{w.terminate()}}"+
    "return {parent:await attempt('./src/runner-worker.js',{wasm:start}),"+
    "child:await attempt('./src/actor-guest-worker.js',{kind:'init',version:1,actorId:0,wasm:start}),"+
    "oversize:await attempt('./src/actor-guest-worker.js',{kind:'init',version:1,actorId:0,wasm:new Uint8Array(1048577)})}})()");
  assert.equal(hardened.parent.ok,false);
  assert.match(hardened.parent.message,/E_GUEST_WASM_START/);
  assert.deepEqual(hardened.child,{kind:'error',message:'E_GUEST_WASM_START'});
  assert.deepEqual(hardened.oversize,{kind:'error',message:'E_ACTOR_WASM'});
  ok('both Wasm domains reject valid start sections and child oversized input');

  // Cancellation is a one-way lifecycle transition even if it arrives before
  // the parent worker receives init; stale init cannot revive guest main().
  const preCancelled=await js("(async()=>{const bytes=Uint8Array.from(atob("+
    JSON.stringify(actorGuest)+"),c=>c.charCodeAt(0));"+
    "const w=new Worker('./src/runner-worker.js',{type:'module'});"+
    "try{return await new Promise((resolve,reject)=>{"+
    "const deadline=setTimeout(()=>reject(Error('pre-cancel deadline')),5000);"+
    "w.onmessage=e=>{clearTimeout(deadline);resolve(e.data)};"+
    "w.onerror=e=>{clearTimeout(deadline);reject(Error('pre-cancel worker error'))};"+
    "w.postMessage({kind:'cancel'});w.postMessage({wasm:bytes})})}finally{w.terminate()}})()");
  assert.equal(preCancelled.ok,false);
  assert.equal(preCancelled.message,'E_RUN_CANCELLED');
  assert.equal(preCancelled.stdout,'');
  ok('cancel-before-init is terminal and cannot revive guest main');

  // A tiny validated Wasm binary may still declare a huge or unbounded
  // memory/table. Real parent and child Workers must refuse it before
  // compilation/instantiation, not only reject >1 MiB binary source files.
  const resourceCases=['unbounded','tooLarge','tooLargeInitial','importedMemory',
    'table','importedTable'].map(kind=>({
      kind,bytes:Buffer.from(resourceWasmFixture(kind)).toString('base64')
    }));
  const resourceDenials=await js("(async()=>{const cases="+JSON.stringify(resourceCases)+";"+
    "async function attempt(path,packet){const w=new Worker(path,{type:'module'});"+
    "try{return await new Promise((resolve,reject)=>{"+
    "const timer=setTimeout(()=>reject(Error('Wasm resource admission timeout')),5000);"+
    "w.onmessage=e=>{clearTimeout(timer);resolve(e.data)};"+
    "w.onerror=e=>{clearTimeout(timer);reject(Error('Wasm resource worker error'))};"+
    "w.postMessage(packet)})}finally{w.terminate()}}"+
    "const results=[];for(const test of cases){"+
    "const wasm=Uint8Array.from(atob(test.bytes),c=>c.charCodeAt(0));"+
    "results.push({kind:test.kind,valid:WebAssembly.validate(wasm),"+
    "parent:await attempt('./src/runner-worker.js',{wasm}),"+
    "child:await attempt('./src/actor-guest-worker.js',{kind:'init',actorId:0,version:1,wasm})})}"+
    "return results})()");
  for(const item of resourceDenials){
    assert.equal(item.valid,true,item.kind+' must be a valid Wasm negative');
    const reason=/Table/i.test(item.kind)?'E_GUEST_WASM_TABLE':'E_GUEST_WASM_MEMORY';
    assert.equal(item.parent.ok,false,item.kind);
    assert.match(item.parent.message,new RegExp(reason),item.kind);
    assert.deepEqual(item.child,{kind:'error',message:reason},item.kind);
  }
  ok('both real worker domains deny valid unbounded memories, oversized memories and tables');

  // This guest has a deliberately noncooperative infinite receive loop in a
  // *nested* Worker. Wait until its script has been fetched (spawn occurred),
  // cancel the parent while suspended on its pending reply, and verify a
  // terminal cancellation error. The parent stays responsive to cancellation.
  const stuckBytes=Buffer.from(actorProgramFixture({twoActors:false,stuckReceive:true})).toString('base64');
  const priorChildLoads=requests.filter(r=>r.url?.includes('/play/src/actor-guest-worker.js')).length;
  await js("(()=>{const bytes=Uint8Array.from(atob("+
    JSON.stringify(stuckBytes)+"),c=>c.charCodeAt(0));"+
    "const w=new Worker('./src/runner-worker.js',{type:'module'});"+
    "window.__stuckRunner=w;"+
    "window.__stuckRunnerMessages=[];"+
    "window.__stuckRunnerResult=new Promise((resolve,reject)=>{"+
    "const timer=setTimeout(()=>reject(Error('stuck child cancel deadline')),6000);"+
    "w.onmessage=e=>{window.__stuckRunnerMessages.push(e.data);"+
    "if(window.__stuckRunnerMessages.length===2){clearTimeout(timer);"+
    "resolve(window.__stuckRunnerMessages)}};"+
    "w.onerror=e=>{clearTimeout(timer);reject(Error('stuck runner error'))}});"+
    "w.postMessage({wasm:bytes});return true})()");
  try {
    await poll(async()=>requests.filter(r=>r.url?.includes('/play/src/actor-guest-worker.js')).length>priorChildLoads
      ?true:null,'stuck nested worker script fetched',80);
    await js("window.__stuckRunner.postMessage({kind:'cancel'})");
    // A canceled one-shot parent refuses reinitialization even after a child
    // is killed; it cannot report actor completion or reuse a stale namespace.
    await js("window.__stuckRunner.postMessage({wasm:new Uint8Array([0,97,115,109,1,0,0,0])})");
    const messages=await js("window.__stuckRunnerResult");
    assert.equal(messages.length,2);
    assert.ok(messages.every(r=>r.ok===false));
    assert.ok(messages.some(r=>/E_ACTOR_CANCELLED|E_RUN_CANCELLED/.test(r.message)));
    assert.ok(messages.every(r=>!r.ok && !r.stdout.includes('receive(')));
    ok('parent cancels noncooperative infinite-loop child without ACK or worker reuse');

  } finally {
    await js("(()=>{window.__stuckRunner?.terminate();"+
      "delete window.__stuckRunner;delete window.__stuckRunnerResult;"+
      "delete window.__stuckRunnerMessages})()");
  }


  // Forcefully kill a parent after it starts four noncooperative nested
  // actors. Chromium CDP's browser Target.getTargets does not expose nested
  // worker targets in CI, so inspect the four actual script requests and
  // outcome isolation; do not confuse that with a process-level orphan proof.
  const fourStuck=Buffer.from(actorStressFixture({
    actorCount:4,messagesPerActor:1,stuckReceive:true
  })).toString('base64');
  const oldChildLoads=requests.filter(r=>r.url?.includes('/play/src/actor-guest-worker.js')).length;
  await js("(()=>{const bytes=Uint8Array.from(atob("+
    JSON.stringify(fourStuck)+"),c=>c.charCodeAt(0));"+
    "window.__fourChildParent=new Worker('./src/runner-worker.js',{type:'module'});"+
    "window.__fourChildMessages=[];"+
    "window.__fourChildParent.onmessage=e=>window.__fourChildMessages.push(e.data);"+
    "window.__fourChildParent.postMessage({wasm:bytes})})()");
  try {
    await poll(async()=>{
      const hits=requests.filter(r=>r.url?.includes('/play/src/actor-guest-worker.js')).length;
      return hits>=oldChildLoads+4?hits:null;
    },'four child worker script fetches before forced parent kill',28);
    assert.deepEqual(await js('window.__fourChildMessages'),[]);
    await js('window.__fourChildParent.terminate()');
    await sleep(200);
    assert.deepEqual(await js('window.__fourChildMessages'),[],
      'forcibly terminated parent must never report late success');
    // A new parent can execute the same independent actor ABI after the old
    // parent was forcibly stopped, without its old scope leaking replies.
    const freshResult=await js("(async()=>{const bytes=Uint8Array.from(atob("+
      JSON.stringify(actorGuest)+"),c=>c.charCodeAt(0));"+
      "const w=new Worker('./src/runner-worker.js',{type:'module'});"+
      "try{return await new Promise((resolve,reject)=>{"+
      "const timer=setTimeout(()=>reject(Error('fresh parent recovery deadline')),5000);"+
      "w.onmessage=e=>{clearTimeout(timer);resolve(e.data)};"+
      "w.onerror=e=>{clearTimeout(timer);reject(Error('fresh parent worker error'))};"+
      "w.postMessage({wasm:bytes})})}finally{w.terminate()}})()");
    assert.equal(freshResult.ok,true,JSON.stringify(freshResult));
    assert.equal(freshResult.value,'42');
    assert.deepEqual(await js('window.__fourChildMessages'),[]);
    ok('forceful parent kill with four nested child loads suppresses late completion and recovers');
  } finally {
    await js("(()=>{window.__fourChildParent?.terminate();"+
      "delete window.__fourChildParent;delete window.__fourChildMessages})()");
  }









  assert.ok(requests.some(r=>r.url.includes('/play/public/atto_compiler.wasm')));
  assert.ok(requests.every(r=>r.method==='GET'),'Unexpected server-side submission of code');
  ok('compiler Wasm served as static GET, no source POST');
  console.log('PASS: '+passed+' real-browser E2E scenarios');
} finally {
  try {socket?.close();}catch{}
  if(chrome&&chrome.exitCode===null){
    const closed=new Promise(resolve=>chrome.once('close',resolve));
    chrome.kill('SIGKILL');
    await deadline(closed,3000).catch(()=>{});
  }
  if(listening) await new Promise(resolve=>server.close(resolve));
  await Promise.all([
    rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:100}),
    rm(downloads,{recursive:true,force:true,maxRetries:10,retryDelay:100})
  ]);
}
