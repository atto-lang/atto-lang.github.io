const samples = {
  arithmetic: `// AttoLang · integer arithmetic\nfnc main() -> int {\n  const int x = 6;\n  int y = 7;\n  return x * y;\n}`,
  immutable: `// Immutable by default: const is optional\nfnc main() -> int {\n  int x = 7;\n  const y = 5;\n  const int z = 3;\n  return x * y + z;\n}`,
  mutable: `// Explicit rebinding uses let or mut\nfnc main() -> int {\n  let int counter = 40;\n  counter = counter + 2;\n  return counter;\n}`,
  error: `// An immutable binding cannot be reassigned\nfnc main() -> int {\n  int x = 10;\n  x = 20;\n  return x;\n}`
};
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
let activeWorker = null;
let lastWasm = null;
let activeRunId = 0;
let activeRequest = null;

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
function workerRequest(filename, payload, timeoutMs) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL(filename, import.meta.url), { type: 'module' });
    activeWorker = worker;
    let done = false;
    const finish = (error, result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      worker.terminate();
      if (activeWorker === worker) activeWorker = null;
      if (activeRequest?.worker === worker) activeRequest = null;
      if (error) reject(error); else resolve(result);
    };
    const timer = setTimeout(() => finish(new Error('Execution deadline exceeded')), timeoutMs);
    activeRequest = { worker, cancel: () => finish(new Error('Operation cancelled')) };
    worker.onmessage = event => finish(null, event.data);
    worker.onerror = () => finish(new Error('Worker failed to load or execute'));
    worker.postMessage(payload);
  });
}
async function run() {
  if (working) return;
  const runId = ++activeRunId;
  setRunning(true);
  lastWasm = null;
  downloadButton.disabled = true;
  diagnostics.textContent = '';
  bytesLabel.textContent = '—';
  display('Compiling Atto source inside WebAssembly…');
  try {
    const start = performance.now();
    const compiled = await workerRequest('./compiler-worker.js', { source: editor.value }, 3000);
    if (runId !== activeRunId) return;
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
    const executed = await workerRequest('./runner-worker.js', { wasm: lastWasm }, 3000);
    if (runId !== activeRunId) return;
    if (!executed.ok) {
      display(executed.message, 'error');
      return;
    }
    display(`main() → ${executed.value}\n\nCompiled ${lastWasm.byteLength} bytes of Wasm · ${Math.round(performance.now() - start)} ms`, 'success');
  } catch (error) {
    if (runId === activeRunId) display(`E_HOST: ${error.message}`, 'error');
  } finally { if (runId === activeRunId) setRunning(false); }
}
function stop() {
  if (!working) return;
  activeRunId++;
  activeRequest?.cancel();
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
selector.addEventListener('change', () => { editor.value = samples[selector.value]; invalidateArtifact(); });
runButton.addEventListener('click', run);
stopButton.addEventListener('click', stop);
shareButton.addEventListener('click', share);
downloadButton.addEventListener('click', download);
editor.value = fromHash() ?? samples.arithmetic;
status.textContent = 'Ready';
// Only used by the automated, local browser test; does not change normal browsing.
const smoke = new URLSearchParams(location.search).get('smoke');
if (smoke === '1') run();
if (smoke === 'error') { selector.value = 'error'; editor.value = samples.error; run(); }
