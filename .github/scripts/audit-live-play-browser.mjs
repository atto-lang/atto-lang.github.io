/** Read-only browser acceptance check against the actually published /play/ origin. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const profile = await mkdtemp(join(tmpdir(), 'atto-live-audit-'));
const chrome = spawn(process.env.CHROME_BIN || 'chromium', [
  '--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
  '--disable-gpu', '--disable-background-networking', '--no-first-run',
  '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0',
  '--user-data-dir=' + profile, 'about:blank',
], {stdio: ['ignore', 'ignore', 'pipe']});
let errors = '';
chrome.stderr.on('data', b => { errors = (errors + b.toString()).slice(-3000); });
chrome.on('error', e => { errors += String(e); });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function poll(fn, label, attempts = 200) {
  let last;
  for (let i = 0; i < attempts; i++) {
    if (chrome.exitCode !== null) throw Error('Chromium exited: ' + errors);
    try { const v = await fn(); if (v) return v; last = v; }
    catch (e) { last = String(e); }
    await sleep(100);
  }
  throw Error(label + ' timed out: ' + JSON.stringify(last));
}
let socket;
try {
  const port = await poll(async () => {
    const f = await readFile(join(profile, 'DevToolsActivePort'), 'utf8');
    const n = Number(f.split('\n')[0]);
    return Number.isInteger(n) && n > 0 ? n : null;
  }, 'Chromium DevTools port', 250);
  const targets = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
  const page = targets.find(x => x.type === 'page' && x.webSocketDebuggerUrl);
  assert.ok(page, 'No Chromium page target');
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, {once: true});
    socket.addEventListener('error', reject, {once: true});
  });
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener('message', event => {
    const m = JSON.parse(event.data);
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    m.error ? p.reject(Error(m.error.message)) : p.resolve(m.result);
  });
  function cmd(method, params = {}) {
    return Promise.race([
      new Promise((resolve, reject) => {
        const id = ++nextId;
        pending.set(id, {resolve, reject});
        socket.send(JSON.stringify({id, method, params}));
      }),
      new Promise((_, reject) => setTimeout(() => reject(Error(method + ' deadline')), 10000))
    ]);
  }
  async function js(expression) {
    const r = await cmd('Runtime.evaluate', {expression, returnByValue: true, awaitPromise: true});
    if (r.exceptionDetails) throw Error(r.exceptionDetails.text);
    return r.result?.value;
  }
  const snapshot = "() => {const q=s=>document.querySelector(s);return {origin:location.origin,source:q('#source')?.value,options:Array.from(q('#example')?.options||[]).map(x=>x.value),kind:q('#summary')?.dataset.kind,output:q('#output')?.textContent,diagnostics:q('#diagnostics')?.textContent,bytes:q('#bytes')?.textContent,downloadDisabled:q('#download')?.disabled,runDisabled:q('#run')?.disabled}}";
  const view = () => js('(' + snapshot + ')()');
  await cmd('Page.enable');
  await cmd('Runtime.enable');
  const nav = await cmd('Page.navigate', {url: 'https://atto-lang.github.io/play/'});
  if (nav.errorText) throw Error('Chromium navigation failed: ' + nav.errorText);
  const pageState = await poll(async () => {
    const s = await view();
    return s?.source?.includes('fnc main') ? s : null;
  }, 'live page editor');
  assert.equal(pageState.origin, 'https://atto-lang.github.io');
  assert.ok(pageState.options.includes('fib'), 'original Fibonacci option is missing');
  assert.ok(!pageState.options.includes('fib-match'), 'new option unexpectedly live');
  console.log('PASS live Chromium: editor and original Fibonacci dropdown present; match option absent');
  await js("(() => {const e=document.querySelector('#example');e.value='fib';e.dispatchEvent(new Event('change',{bubbles:true}));return true})()");
  await poll(async () => (await view())?.source?.includes('if n < 2 then'), 'original Fibonacci source');
  await js("document.querySelector('#run').click()");
  const original = await poll(async () => {
    const s = await view();
    return !s?.runDisabled && (s.kind === 'success' || s.kind === 'error') ? s : null;
  }, 'original Fibonacci execution', 270);
  assert.equal(original.kind, 'success', JSON.stringify(original));
  assert.match(original.output, /^0 1 1 2 3 5 8 13 21 34 \nmain\(\) → 144/);
  assert.equal(original.downloadDisabled, false);
  console.log('PASS live Chromium: original Fibonacci compiles to actual Wasm, prints sequence and returns 144');
  const match = 'fnc fib(int n): int {\n  return match n over\n    on 0 -> 0,\n    on 1 -> 1,\n    default -> fib(n - 1) + fib(n - 2),\n  end\n}\npub fnc main(): int { return fib(12); }';
  await js("(() => {const e=document.querySelector('#source');e.value=" + JSON.stringify(match) + ";e.dispatchEvent(new Event('input',{bubbles:true}));return true})()");
  await js("document.querySelector('#run').click()");
  const rejected = await poll(async () => {
    const s = await view();
    return !s?.runDisabled && (s.kind === 'success' || s.kind === 'error') ? s : null;
  }, 'return match compiler attempt', 270);
  assert.equal(rejected.kind, 'error', JSON.stringify(rejected));
  assert.match(rejected.diagnostics, /E_/);
  assert.equal(rejected.downloadDisabled, true);
  assert.equal(rejected.bytes, '—');
  console.log('PASS live Chromium: return-match is rejected by older public compiler, no guest Wasm generated');
} finally {
  try { socket?.close(); } catch {}
  if (chrome.exitCode === null) {
    chrome.kill('SIGKILL');
    await sleep(150);
  }
  await rm(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
}
