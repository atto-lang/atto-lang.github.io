/** Dependency-free real Chromium browser E2E using the DevTools Protocol.
 * No virtual-time acceleration: real Web Workers must finish before deadline.
 */
import { createServer } from 'node:http';
import { readFile, stat, mkdtemp, rm } from 'node:fs/promises';
import { resolve, extname, sep, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const root = resolve(new URL('..', import.meta.url).pathname);
const mime = { '.js': 'text/javascript; charset=utf-8', '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.wasm': 'application/wasm', '.md': 'text/plain; charset=utf-8' };
const server = createServer(async (req, res) => {
  try {
    const rel = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/+/, '') || 'index.html';
    const abs = resolve(root, rel);
    if (abs !== root && !abs.startsWith(root + sep)) {res.writeHead(403);res.end();return;}
    if (!(await stat(abs)).isFile()) throw new Error('Not a file');
    res.writeHead(200, {'Content-Type': mime[extname(abs)] || 'application/octet-stream', 'X-Content-Type-Options':'nosniff'});
    res.end(await readFile(abs));
  } catch {res.writeHead(404);res.end('Not found');}
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const serverPort = server.address().port;
const userDir = await mkdtemp(join(tmpdir(), 'atto-chrome-'));
// Ask Chromium to allocate a private debugging port for this temporary profile.
const chrome = spawn(process.env.CHROME_BIN || 'chromium', [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  '--disable-background-networking', '--no-first-run', '--no-proxy-server',
  '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', `--user-data-dir=${userDir}`, 'about:blank'
], {stdio:['ignore','ignore','pipe']});
let chromeLog='';
chrome.stderr.on('data', chunk => {chromeLog=(chromeLog+chunk.toString()).slice(-3000);});
chrome.on('error', err => {chromeLog += String(err);});
const sleep = ms => new Promise(resolve => setTimeout(resolve,ms));
async function waitForPort(){
  for(let i=0;i<300;i++){
    try {
      const file = await readFile(join(userDir, 'DevToolsActivePort'), 'utf8');
      const port = Number(file.split('\\n')[0]);
      if (Number.isInteger(port) && port > 0 && port < 65536) {
        const response=await fetch(`http://127.0.0.1:${port}/json/list`,{signal:AbortSignal.timeout(900)});
        if(response.ok)return port;
      }
    }catch{}
    if(chrome.exitCode!==null)throw new Error(`Chrome exited: ${chromeLog}`);
    await sleep(100);
  }
  throw new Error(`Chrome DevTools endpoint not reachable: ${chromeLog}`);
}

function timeout(promise, ms, label){
  let timer;
  return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(`${label} timed out`)),ms);})]).finally(()=>clearTimeout(timer));
}
let ws;
try {
  const port=await waitForPort();
  const targets=await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page=targets.find(x=>x.type==='page'&&x.webSocketDebuggerUrl);
  if(!page)throw new Error('No debuggable Chrome page');
  ws=new WebSocket(page.webSocketDebuggerUrl);
  await timeout(new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});}),3000,'CDP connection');
  const pending=new Map();let nextId=1;
  ws.addEventListener('message',event=>{
    const msg=JSON.parse(event.data);
    if(msg.id&&pending.has(msg.id)){const {resolve,reject}=pending.get(msg.id);pending.delete(msg.id);msg.error?reject(new Error(msg.error.message)):resolve(msg.result);}
  });
  const send=(method,params={})=>timeout(new Promise((resolve,reject)=>{
    const id=nextId++;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));
  }),5000,method);
  await send('Page.enable');await send('Runtime.enable');
  async function navigateAndWait(query, expectation){
    const navigation=await send('Page.navigate',{url:`http://127.0.0.1:${serverPort}/?smoke=${query}`});
    if(navigation?.errorText) throw new Error(`Chromium navigation denied: ${navigation.errorText}`);
    let last='';
    for(let i=0;i<100;i++){
      const evaluated=await send('Runtime.evaluate',{
        expression:`JSON.stringify({kind:document.querySelector('#summary')?.dataset.kind||'loading',output:document.querySelector('#output')?.textContent||'',diagnostics:document.querySelector('#diagnostics')?.textContent||'',bytes:document.querySelector('#bytes')?.textContent||''})`,
        returnByValue:true
      });
      const value=evaluated?.result?.value;
      if(typeof value==='string'){
        const state=JSON.parse(value);last=JSON.stringify(state);
        if(expectation(state)){return state;}
        if(state.kind==='error' && query==='1') throw new Error(`Browser compilation failed: ${last}`);
      }
      await sleep(100);
    }
    throw new Error(`Browser worker result not received: ${last}\n${chromeLog.slice(-500)}`);
  }
  const positive=await navigateAndWait('1',state=>state.kind==='success'&&state.output.includes('main() → 42'));
  assert.match(positive.bytes,/\d+ bytes/);
  console.log('PASS: Chromium compiled Atto inside Wasm and ran generated guest → 42');
  const negative=await navigateAndWait('error',state=>state.kind==='error'&&state.diagnostics.includes('E_IMMUTABLE'));
  assert.equal(negative.bytes,'—');
  console.log('PASS: Chromium rejected immutable reassignment with no Wasm artifact');
} finally {
  try{ws?.close();}catch{}
  if (chrome.exitCode === null) {
    const closed = new Promise(resolve => chrome.once('close', resolve));
    chrome.kill('SIGKILL');
    await timeout(closed, 2500, 'Chrome shutdown').catch(() => {});
  }
  server.close();
  await rm(userDir,{recursive:true,force:true,maxRetries:12,retryDelay:150});
}