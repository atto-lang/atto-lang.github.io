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
