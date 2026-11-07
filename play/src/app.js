import { createWorkerTask } from './worker-task.js';
import { installEditor } from './editor.js';
import { formatDiagnostic, formatWasm } from './ui.js';
import { installProgramPicker } from './program-picker.js';
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
const wasmPreview = document.querySelector('#wasm-preview');
const picker = installProgramPicker({
  selector, editor, nameInput: document.querySelector('#program-name'),
  saveButton: document.querySelector('#save-custom'), deleteButton: document.querySelector('#delete-custom'),
  savedGroup: document.querySelector('#saved-programs'), status, loadSample
});
const tabNames = ['console', 'diagnostics', 'wasm'];
const tabButtons = tabNames.map(name => document.querySelector('#tab-' + name));
function selectTab(name, focus = false) {
  for (const tab of tabNames) {
    const selected = tab === name;
    const button = document.querySelector('#tab-' + tab);
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
    document.querySelector('#panel-' + tab).hidden = !selected;
    if (selected && focus) button.focus();
  }
}
for (const [index, button] of tabButtons.entries()) {
  button.addEventListener('click', () => selectTab(tabNames[index]));
  button.addEventListener('keydown', event => {
    const move = { ArrowRight: 1, ArrowLeft: -1, Home: -index, End: tabNames.length - 1 - index }[event.key];
    if (move === undefined) return;
    event.preventDefault();
    selectTab(tabNames[(index + move + tabNames.length) % tabNames.length], true);
  });
}
function showDiagnostic(value) {
  const item = formatDiagnostic(value);
  const link = document.createElement('button');
  link.type = 'button';
  link.className = 'diagnostic-link';
  link.textContent = item.line + ':' + item.column + ' ' + item.message;
  link.setAttribute('aria-label', 'Go to line ' + item.line + ', column ' + item.column + ': ' + item.message);
  link.addEventListener('click', () => jumpTo(item.line, item.column));
  diagnostics.replaceChildren(link);
}
const jumpTo = installEditor(editor, {
  gutter: document.querySelector('#line-gutter'),
  cursor: document.querySelector('#cursor'),
  onRun: () => { if (!working) run(); }
});
let working = false;
const workerTask = createWorkerTask();
const COMPILE_DEADLINE_MS = 10000;
const RUN_DEADLINE_MS = 3000;
let runGeneration = 0;
let lastWasm = null;

const splitter = document.querySelector('#splitter');
const workbench = document.querySelector('.workbench');
let editorPaneWidth = 53;
function resizeEditorPane(value) {
  if (!Number.isFinite(value)) return;
  editorPaneWidth = Math.max(25, Math.min(75, Math.round(value)));
  workbench.style.setProperty('--editor-pane-width', editorPaneWidth + '%');
  splitter.setAttribute('aria-valuenow', String(editorPaneWidth));
}
function resizeFromPointer(event) {
  const bounds = workbench.getBoundingClientRect();
  if (bounds.width > 0) resizeEditorPane((event.clientX - bounds.left) * 100 / bounds.width);
}
splitter.addEventListener('pointerdown', event => {
  if (event.button !== 0 && event.pointerType !== 'touch') return;
  event.preventDefault();
  splitter.setPointerCapture(event.pointerId);
  resizeFromPointer(event);
});
splitter.addEventListener('pointermove', event => {
  if (splitter.hasPointerCapture(event.pointerId)) resizeFromPointer(event);
});
function endResize(event) {
  if (splitter.hasPointerCapture(event.pointerId)) splitter.releasePointerCapture(event.pointerId);
}
splitter.addEventListener('pointerup', endResize);
splitter.addEventListener('pointercancel', endResize);
splitter.addEventListener('dblclick', () => resizeEditorPane(53));
splitter.addEventListener('keydown', event => {
  const next = {
    ArrowLeft: editorPaneWidth - 5,
    ArrowRight: editorPaneWidth + 5,
    Home: 25,
    End: 75,
    '0': 53
  }[event.key];
  if (next === undefined) return;
  event.preventDefault();
  resizeEditorPane(next);
});

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
  if (value) status.textContent = 'Compiling';
  else if (status.textContent === 'Compiling' || status.textContent === 'Executing') status.textContent = 'Ready';
}
async function run() {
  if (working) return;
  const generation = ++runGeneration;
  setRunning(true);
  lastWasm = null;
  downloadButton.disabled = true;
  diagnostics.textContent = 'No diagnostics.';
  wasmPreview.textContent = 'No compiled artifact yet.';
  selectTab('console');
  bytesLabel.textContent = '—';
  display('Compiling Atto source inside WebAssembly…');
  try {
    const start = performance.now();
    const compiled = await workerTask.request(new URL('./compiler-worker.js', import.meta.url), { source: editor.value }, COMPILE_DEADLINE_MS, 'Compilation');
    if (generation !== runGeneration) return;
    if (!compiled.ok) {
      showDiagnostic(compiled.diagnostics?.[0]);
      status.textContent = 'Compiler error';
      selectTab('diagnostics');
      display('Compilation failed. No WebAssembly artifact was produced.', 'error');
      return;
    }
    lastWasm = compiled.wasm;
    wasmPreview.textContent = formatWasm(lastWasm);
    bytesLabel.textContent = `${lastWasm.byteLength} bytes`;
    downloadButton.disabled = false;
    status.textContent = 'Executing';
    const executed = await workerTask.request(new URL('./runner-worker.js', import.meta.url), { wasm: lastWasm }, RUN_DEADLINE_MS, 'Execution');
    if (generation !== runGeneration) return;
    const printed = executed.stdout ? executed.stdout + (executed.truncated ? '\n[output truncated]\n' : '') + (executed.stdout.endsWith('\n') ? '' : '\n') : '';
    if (!executed.ok) {
      status.textContent = 'Runtime error';
      display(`${printed}${executed.message}`, 'error');
      return;
    }
    status.textContent = 'Completed';
    display(`${printed}main() → ${executed.value}\n\nCompiled ${lastWasm.byteLength} bytes of Wasm · ${Math.round(performance.now() - start)} ms`, 'success');
  } catch (error) {
    if (generation === runGeneration) {
      status.textContent = 'Worker error';
      display(`E_HOST: ${error.message}`, 'error');
    }
  } finally { if (generation === runGeneration) setRunning(false); }
}
function stop() {
  if (!working) return;
  // Invalidate the old run before resolving its pending worker request.
  runGeneration++;
  workerTask.cancel();
  setRunning(false);
  status.textContent = 'Cancelled';
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
  // Avoid cancelling a pending browser download by revoking synchronously.
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
function invalidateArtifact() {
  lastWasm = null;
  downloadButton.disabled = true;
  bytesLabel.textContent = '—';
  diagnostics.textContent = 'No diagnostics.';
  wasmPreview.textContent = 'No compiled artifact yet.';
  if (!working) {
    status.textContent = 'Source edited';
    selectTab('console');
    display('Source changed. Run to compile.');
  }
}
editor.addEventListener('input', invalidateArtifact);

runButton.addEventListener('click', run);
stopButton.addEventListener('click', stop);
shareButton.addEventListener('click', share);
downloadButton.addEventListener('click', download);
status.textContent = 'Loading';
(async () => {
  const shared = fromHash();
  try { await picker.initialize(shared); } catch (error) { display(`E_HOST: ${error.message}`, 'error'); }
  status.textContent = 'Ready';
  // Only used by the automated, local browser test; does not change normal browsing.
  const smoke = new URLSearchParams(location.search).get('smoke');
  if (smoke === '1') run();
  if (smoke === 'error') { selector.value = 'error'; editor.value = await loadSample('error'); run(); }
})();
