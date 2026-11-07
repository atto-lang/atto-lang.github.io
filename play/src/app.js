import { createWorkerTask } from './worker-task.js';
// Example programs live in /examples as real .atto files; each one is also
// compiled by the Java reference compiler in the differential test suite.
const EXAMPLES = ['hello', 'fib', 'primes', 'conditions', 'overflow', 'error'];
const samples = {};
async function loadSample(name) {
  if (!EXAMPLES.includes(name)) throw new Error('unknown example');
  if (!samples[name]) {
    const response = await fetch(new URL(`../examples/${name}.atto`, import.meta.url));
    if (!response.ok) throw new Error(`example download failed (${response.status})`);
    samples[name] = await response.text();
  }
  return samples[name];
}
const editor = document.querySelector('#source');
const output = document.querySelector('#output');
const summary = document.querySelector('#summary');
const runButton = document.querySelector('#run');
const stopButton = document.querySelector('#stop');
const selector = document.querySelector('#example');
const shareButton = document.querySelector('#share');
const downloadButton = document.querySelector('#download');
const diagnostics = document.querySelector('#diagnostics');
const status = document.querySelector('#status');
const bytesLabel = document.querySelector('#bytes');
let working = false;
const workerTask = createWorkerTask();
let runGeneration = 0;
let lastWasm = null;

function display(message, kind = 'neutral') {
  output.textContent = message;
  summary.textContent = kind === 'error' ? 'Failed' : kind === 'success' ? 'Completed' : 'Ready';
  summary.dataset.kind = kind;
}
function setRunning(value) {
  working = value;
  runButton.disabled = value;
  stopButton.disabled = !value;
  editor.readOnly = value;
  selector.disabled = value;
  status.textContent = value ? 'Compiling' : 'Ready';
}
async function run() {
  if (working) return;
  const generation = ++runGeneration;
  setRunning(true);
  lastWasm = null;
  downloadButton.disabled = true;
  diagnostics.textContent = '';
  bytesLabel.textContent = '—';
  display('Compiling Atto source inside WebAssembly…');
  try {
    const start = performance.now();
    const compiled = await workerTask.request(new URL('./compiler-worker.js', import.meta.url), { source: editor.value }, 3000);
    if (generation !== runGeneration) return;
    if (!compiled.ok) {
      const first = compiled.diagnostics[0];
      diagnostics.textContent = `${first.line}:${first.column} ${first.message}`;
      display('No WebAssembly artifact was produced.', 'error');
      return;
    }
    lastWasm = compiled.wasm;
    bytesLabel.textContent = `${lastWasm.byteLength} bytes`;
    downloadButton.disabled = false;
    status.textContent = 'Executing';
    const executed = await workerTask.request(new URL('./runner-worker.js', import.meta.url), { wasm: lastWasm }, 3000);
    if (generation !== runGeneration) return;
    const printed = executed.stdout ? executed.stdout + (executed.truncated ? '\n[output truncated]\n' : '') + (executed.stdout.endsWith('\n') ? '' : '\n') : '';
    if (!executed.ok) {
      display(`${printed}${executed.message}`, 'error');
      return;
    }
    display(`${printed}main() → ${executed.value}\n\nCompiled ${lastWasm.byteLength} bytes of Wasm · ${Math.round(performance.now() - start)} ms`, 'success');
  } catch (error) {
    if (generation === runGeneration) display(`E_HOST: ${error.message}`, 'error');
  } finally { if (generation === runGeneration) setRunning(false); }
}
function stop() {
  if (!working) return;
  // Invalidate the old run before resolving its pending worker request.
  runGeneration++;
  workerTask.cancel();
  setRunning(false);
  display('Compilation or execution cancelled.', 'neutral');
}
function fromHash() {
  const match = /^#code=([A-Za-z0-9_-]{1,5500})$/.exec(location.hash);
  if (!match) return null;
  try {
    const b64 = match[1].replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(b64), char => char.charCodeAt(0));
    const value = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return value.length <= 4096 ? value : null;
  } catch { return null; }
}
async function share() {
  const bytes = new TextEncoder().encode(editor.value);
  if (bytes.length > 4096) { display('Source too large to share in a URL.', 'error'); return; }
  let text = '';
  for (const byte of bytes) text += String.fromCharCode(byte);
  const slug = btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const url = new URL(location.href); url.hash = `code=${slug}`;
  try {
    await navigator.clipboard.writeText(url.toString());
    status.textContent = 'Share link copied';
  } catch { status.textContent = 'Copy URL from address bar'; }
  location.hash = url.hash;
}
function download() {
  if (!lastWasm) return;
  const blob = new Blob([lastWasm], { type: 'application/wasm' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'main.wasm';
  a.click();
  URL.revokeObjectURL(url);
}
function invalidateArtifact() {
  lastWasm = null;
  downloadButton.disabled = true;
  bytesLabel.textContent = '—';
  diagnostics.textContent = '';
  if (!working) display('Source changed. Run to compile.');
}
editor.addEventListener('input', invalidateArtifact);
selector.addEventListener('change', async () => {
  try { editor.value = await loadSample(selector.value); } catch (error) { display(`E_HOST: ${error.message}`, 'error'); return; }
  invalidateArtifact();
});
runButton.addEventListener('click', run);
stopButton.addEventListener('click', stop);
shareButton.addEventListener('click', share);
downloadButton.addEventListener('click', download);
status.textContent = 'Loading';
(async () => {
  const shared = fromHash();
  try { editor.value = shared ?? await loadSample('hello'); } catch (error) { display(`E_HOST: ${error.message}`, 'error'); }
  status.textContent = 'Ready';
  // Only used by the automated, local browser test; does not change normal browsing.
  const smoke = new URLSearchParams(location.search).get('smoke');
  if (smoke === '1') run();
  if (smoke === 'error') { selector.value = 'error'; editor.value = await loadSample('error'); run(); }
})();
