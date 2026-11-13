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
    // A previous selection can leave "Source changed" in Output while the new
    // .atto fetch is pending. Wait for the editor's actual input event instead.
    const selected=await js("(async()=>{const input=document.querySelector('#source');const loaded=new Promise(resolve=>input.addEventListener('input',resolve,{once:true}));const e=document.querySelector('#example');e.value="+JSON.stringify(name)+";if(e.value!=="+JSON.stringify(name)+")throw new Error('Example missing');e.dispatchEvent(new Event('change',{bubbles:true}));await loaded;return e.value;})()");
    assert.equal(selected,name,'example '+name+' did not finish loading');
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

  // Exercise every dropdown preview, including caller-side trap and Result/Option.
  // The menu is the source of truth, so adding a preview cannot silently skip
  // the browser-level fail-closed regression check.
  const previewOptions = await js("Array.from(document.querySelectorAll('#example optgroup'), group => ({label: group.label, values: Array.from(group.querySelectorAll('option'), option => option.value)})).find(group => group.label === 'Language previews — not executable yet')?.values");
  assert.ok(Array.isArray(previewOptions) && previewOptions.length >= 17, 'preview optgroup missing');
  assert.ok(previewOptions.includes('preview/trap'), 'trap preview missing');
  assert.ok(previewOptions.includes('preview/result-option'), 'Result/Option preview missing');
  assert.ok(previewOptions.includes('preview/result-option-end'), 'end-delimited Result/Option preview missing');
  for (const name of previewOptions) {
    await example(name);
    const current = await view();
    assert.match(current.source, /^\/\/ (?:PREVIEW ONLY:|SYNTAX PREVIEW)/, name);
    assert.equal(current.runDisabled, true, name + ': Run must be disabled');
    assert.equal(current.downloadDisabled, true, name + ': no stale guest download');
    assert.equal(current.bytes, '—', name + ': no compiled artifact');
    assert.equal(await js("document.querySelector('#example-support').dataset.support"), 'preview');
    assert.equal(await js("document.querySelector('#format').disabled && document.querySelector('#check-format').disabled"), true);
    if (name === 'preview/result-option-end') {
      assert.match(current.source, /^fnc validate_port\(int port\) -> Result<int, string>\n/m);
      assert.match(current.source, /^fnc optional_port\(bool present\) -> Option<int> ::\n/m);
      assert.equal(await js("document.querySelector('#example').selectedOptions[0].textContent"), 'Result / Option — end functions');
    }
    if (name === 'preview/trap') {
      assert.match(current.source, /Option<Result<int, String>> success = trap checked_id\(5\)/);
      assert.match(current.source, /Option<Result<int, String>> invalid = trap checked_id\(-1\)/);
      assert.doesNotMatch(current.source, /\btrap\s+fnc\b|\btrap\s+["']/);
      assert.equal(await js("document.querySelector('#example').selectedOptions[0].textContent"), 'trap expression — Option / Result');
      await js("document.querySelector('#source').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',ctrlKey:true,bubbles:true,cancelable:true}))");
      assert.match((await view()).output, /Language preview only:/, 'keyboard Run must reject trap preview');
      assert.equal((await view()).downloadDisabled, true);
    }
  }
  // Test shortcut handling against a second preview, not only trap.
  await js("document.querySelector('#source').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',ctrlKey:true,bubbles:true,cancelable:true}))");
  assert.match((await view()).output, /Language preview only:/);
  assert.equal((await view()).downloadDisabled, true);
  // Copying an unsupported trap preview to an editable custom program
  // must still fail closed at the real browser compiler boundary.
  await example('preview/trap');
  const trapPreviewSource = (await view()).source;
  await js("(()=>{const e=document.querySelector('#example');e.value='custom:new';e.dispatchEvent(new Event('change',{bubbles:true}));})()");
  assert.equal((await view()).source, trapPreviewSource, 'Custom + must preserve the trap example source');
  assert.equal((await view()).runDisabled, false, 'Custom + permits attempting compilation');
  await click('run');
  const rejectedTrap = await poll(async () => {
    const current = await view();
    return current?.kind === 'error' && !current.runDisabled ? current : null;
  }, 'unsupported trap must be rejected by the shipped Wasm compiler');
  assert.equal(rejectedTrap.bytes, '—', 'trap rejection must expose no guest byte count');
  assert.equal(rejectedTrap.downloadDisabled, true, 'trap rejection must expose no downloadable Wasm');
  assert.match(rejectedTrap.diagnostics, /E_[A-Z_]+/, 'trap rejection must have a compiler diagnostic');

  await example('conditions');
  assert.equal((await view()).runDisabled, false);
  await run('success', 'main() → 11');
  ok('all previews are loading-only, keyboard run is guarded, and Conditions still runs in real Wasm');

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
  // Revoke an existing guest synchronously, before a preview sample is fetched.
  const staleGate = await js("(()=>{const e=document.querySelector('#example');e.value='preview/result-option-end';e.dispatchEvent(new Event('change',{bubbles:true}));return {disabled:document.querySelector('#download').disabled,bytes:document.querySelector('#bytes').textContent};})()");
  assert.deepEqual(staleGate, {disabled:true,bytes:'—'});
  await example('hello');
  await run('success','main() → 42');
  ok('preview selection revokes downloadable Wasm without falsely signaling input');
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
  await source('define class Point as\nend\npub fnc main(): int { return 42; }');
  s=await run('error', "top-level 'define'");
  assert.match(s.diagnostics, /deployed compiler does not support top-level define/);
  assert.equal(s.bytes, '—');
  assert.equal(s.downloadDisabled, true);
  assert.equal(await js("document.querySelector('#status').textContent"), 'Compiler feature unavailable');
  await source('pub fnc main(): int { return 42; }');
  await run('success', 'main() → 42');
  ok('unsupported define reports compiler limitation with no artifact, then real Wasm recovers');
  await source('fnc main() -> int { return 2 + ; }');
  s=await run('error','E_SYNTAX');
  assert.equal(s.downloadDisabled,true);
  ok('syntax error rejected in UI');
  await source('define class N as\n  pub int v: 1\nend\nfnc main() -> int {\n  let t = 0;\n  for (let i = 0; i < 1000000; i++) {\n    val n = new N();\n    t = t + n.v;\n  }\n  return t;\n}');
  s=await run('error','E_PANIC: object heap exhausted');
  assert.match(s.bytes,/^\d+ bytes$/);
  ok('runtime panic distinguished from compile error');
  await example('classes');
  s=await run('success','main() → 42');
  assert.match(s.output,/^Account\{id=7, balance=100\}\n125\nmain\(\) → 42/);
  ok('define class: constructor, fields, methods, static fnc and new execute as Wasm');
  await example('enums');
  s=await run('success','main() → 7');
  assert.match(s.output,/^green after 7 changes\nmain\(\) → 7/);
  ok('define enum values compare and flow through functions');
  await example('actors');
  s=await run('success','main() → 0');
  assert.match(s.output,/^main sent 5 messages\n1\n3\n6\n10\n15\nmain\(\) → 0/);
  assert.match(s.output,/1 actor in one tenant worker/);
  ok('define actor: mail is delivered FIFO to actor state inside its tenant worker');
  const counter='define actor Counter as\n  let int total = 0;\n  receive(ActorMail<int> mail): void {\n    self.total = self.total + mail.value;\n    stdio.println(mail.sequence * 1000 + self.total);\n    return;\n  }\nend\n';
  await source(counter+'pub fnc main(): int {\n  val a = spawn Counter();\n  val b = spawn Counter();\n  a.send(1);\n  b.send(10);\n  a.send(2);\n  b.send(20);\n  return 3;\n}');
  s=await run('success','main() → 3');
  {
    const lines=s.output.split('\nmain()')[0].split('\n').sort();
    assert.deepEqual(lines,['1','10','1003','1030'].sort(),'each actor owns its state and sequence');
  }
  assert.match(s.output,/2 actors in one tenant worker/);
  ok('two actors share a tenant worker but have independent state');
  await source('define actor W as\n  receive(ActorMail<int> mail): void {\n    stdio.println(mail.value);\n    stdio.println(mail.value * 9223372036854775807);\n    return;\n  }\nend\npub fnc main(): int {\n  val w = spawn W();\n  w.send(7);\n  w.send(8);\n  return 0;\n}');
  s=await run('error','E_PANIC: integer overflow in actor W#0');
  assert.match(s.output,/^7\nE_PANIC: integer overflow in actor W#0/);
  ok('a panicking actor reports its name and keeps earlier output');
  await source('define actor Spin as\n  receive(ActorMail<int> mail): void {\n    loop { }\n  }\nend\npub fnc main(): int {\n  val s = spawn Spin();\n  s.send(1);\n  return 0;\n}');
  s=await run('error','deadline');
  await example('actors');
  s=await run('success','main() → 0');
  assert.match(s.output,/^main sent 5 messages\n1\n3\n6\n10\n15\nmain\(\) → 0/);
  ok('a non-terminating actor is stopped by the run deadline and the next run recovers');
  await source('define actor W as\n  receive(int value): int {\n    return value + 2;\n  }\nend\npub fnc main(): int { return 0; }');
  s=await run('error','E_TYPE');
  assert.match(s.diagnostics,/ActorMail<T>/);
  ok('non-canonical receive(int): int is rejected like the Java reference');
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
  assert.equal(requests.some(r=>r.url.includes('/play/src/actor-worker.js')),false,'actors must not launch nested Web Workers');
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
