import { createWorkerTask } from './worker-task.js';
import { installEditor } from './editor.js';
import { formatDiagnostic, formatWasm } from './ui.js';
import { installProgramPicker } from './program-picker.js';
import { mapFormatCaret } from './formatter-runtime.js';
// Runnable samples and explicitly labeled language previews live in /examples.
// Preview syntax is illustrative; only the pinned compiler decides admission.
const PREVIEW_EXAMPLES = new Set(["preview/boolean-operators","preview/generators","preview/async-iterators","preview/tasks-async","preview/match-values","preview/match-types-is","preview/use-using-with","preview/function-pipeline","preview/actor-pipeline","preview/supervisor-mailbox","preview/trap","preview/result-option","preview/result-option-end","preview/channel-bounded","preview/channel-probe","preview/channel-unbounded","preview/rx-observable","preview/rx-interop"]);
const EXAMPLES = ['hello', 'fib', 'primes', 'conditions', 'overflow', 'error', 'classes', 'actors', 'enums', ...PREVIEW_EXAMPLES];
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
const formatButton = document.querySelector('#format');
const checkFormatButton = document.querySelector('#check-format');
const supportLabel = document.querySelector('#example-support');
let working = false;
let formatting = false;
function updateExampleSupport() {
  if (PREVIEW_EXAMPLES.has(selector.value)) {
    supportLabel.textContent = 'Language preview — not yet executable in the pinned Wasm compiler';
    supportLabel.dataset.support = 'preview';
  } else if (selector.value.startsWith('saved:') || selector.value === 'custom:new') {
    supportLabel.textContent = 'Custom program — compiler support depends on source';
    supportLabel.dataset.support = 'custom';
  } else {
    supportLabel.textContent = 'Runnable with the pinned browser compiler';
    supportLabel.dataset.support = 'runnable';
  }
  const preview = PREVIEW_EXAMPLES.has(selector.value);
  const controlsDisabled = working || formatting || preview;
  runButton.disabled = controlsDisabled;
  formatButton.disabled = controlsDisabled;
  checkFormatButton.disabled = controlsDisabled;
  runButton.title = preview ? 'Preview only: choose Custom + to experiment' : 'Compile and run';
}

updateExampleSupport();

const shareButton = document.querySelector('#share');
const downloadButton = document.querySelector('#download');
const diagnostics = document.querySelector('#diagnostics');
const status = document.querySelector('#status');
const bytesLabel = document.querySelector('#bytes');
const wasmPreview = document.querySelector('#wasm-preview');
const picker = installProgramPicker({
  selector, editor, nameInput: document.querySelector('#program-name'),
  saveButton: document.querySelector('#save-custom'), deleteButton: document.querySelector('#delete-custom'),
  savedGroup: document.querySelector('#saved-programs'), status, loadSample,
  onSelectionChange: updateExampleSupport,
  onSelectionStart: invalidateArtifact
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
  onRun: () => { if (!working && !formatting) run(); },
  onFormat: () => { if (!working && !formatting) formatCode(false); }
});
const workerTask = createWorkerTask();
const formatterTask = createWorkerTask();
const FORMAT_DEADLINE_MS = 6000;
const COMPILE_DEADLINE_MS = 10000;
const RUN_DEADLINE_MS = 3000;
let runGeneration = 0;
let lastWasm = null;

function display(message, kind = 'neutral') {
  output.textContent = message;
  summary.textContent = kind === 'error' ? 'Failed' : kind === 'success' ? 'Completed' : 'Ready';
  summary.dataset.kind = kind;
}
function setRunning(value) {
  working = value;
  runButton.disabled = value || PREVIEW_EXAMPLES.has(selector.value);
  stopButton.disabled = !value;
  editor.readOnly = value;
  selector.disabled = value;
  formatButton.disabled = value || PREVIEW_EXAMPLES.has(selector.value);
  checkFormatButton.disabled = value || PREVIEW_EXAMPLES.has(selector.value);
  if (value) status.textContent = 'Compiling';
  else if (status.textContent === 'Compiling' || status.textContent === 'Executing') status.textContent = 'Ready';
}
async function run() {
  if (working || formatting) return;
  if (PREVIEW_EXAMPLES.has(selector.value)) {
    status.textContent = 'Preview only';
    display('Language preview only: the pinned compiler cannot run this example. Choose Custom + to experiment with the code.');
    return;
  }
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
    const actorNote = executed.actors ? ` · ${executed.actors} actor${executed.actors === 1 ? '' : 's'} in one tenant worker` : '';
    display(`${printed}main() → ${executed.value}\n\nCompiled ${lastWasm.byteLength} bytes of Wasm · ${Math.round(performance.now() - start)} ms${actorNote}`, 'success');
  } catch (error) {
    if (generation === runGeneration) {
      status.textContent = 'Worker error';
      display(`E_HOST: ${error.message}`, 'error');
    }
  } finally { if (generation === runGeneration) setRunning(false); }
}

/** Run the actual Rust formatter in an isolated, time-limited browser worker.
 * No mutation happens until the worker returns a successful complete result.
 * Browser undo is preserved with native insertText where supported.
 */
async function formatCode(checkOnly) {
  if (working || formatting) return;
  if (PREVIEW_EXAMPLES.has(selector.value)) {
    status.textContent = 'Preview only';
    display('Language preview only: the pinned formatter does not support this syntax. Choose Custom + to experiment.');
    return;
  }
  const before = editor.value, start = editor.selectionStart, end = editor.selectionEnd;
  formatting = true;
  formatButton.disabled = checkFormatButton.disabled = runButton.disabled = true;
  editor.readOnly = true;
  selector.disabled = true;
  status.textContent = checkOnly ? 'Checking canonical formatting' : 'Formatting locally';
  try {
    const result = await formatterTask.request(
      new URL('./formatter-worker.js', import.meta.url), {source:before},
      FORMAT_DEADLINE_MS, 'Formatting'
    );
    if (before !== editor.value) {
      status.textContent = 'Source changed; formatting result discarded';
      return;
    }
    if (!result?.ok) {
      status.textContent = 'Formatter rejected source';
      display('E_FORMAT: ' + (result?.diagnostic || 'Unknown formatter error'), 'error');
      return;
    }
    if (typeof result.formatted !== 'string' ||
      new TextEncoder().encode(result.formatted).length > 262144) {
      throw new Error('Invalid or oversized formatter result');
    }
    if (checkOnly) {
      status.textContent = result.formatted === before ? 'Canonical formatting verified' : 'Formatting differs — click Format to apply';
      return;
    }
    if (result.formatted === before) {
      status.textContent = 'Already canonically formatted';
      return;
    }
    // A single editor edit supports native Ctrl+Z undo where the browser
    // implements insertText; otherwise preserve the textarea selection.
    editor.readOnly = false;
    editor.focus();
    editor.setSelectionRange(0, before.length);
    let changed = false;
    try { changed = document.execCommand('insertText', false, result.formatted); } catch { /* older browsers */ }
    if (!changed || editor.value !== result.formatted) {
      editor.setRangeText(result.formatted, 0, editor.value.length, 'end');
    }
    editor.setSelectionRange(mapFormatCaret(before, result.formatted, start),
      mapFormatCaret(before, result.formatted, end));
    editor.dispatchEvent(new Event('input', {bubbles:true}));
    status.textContent = 'Formatted locally using canonical Rust Wasm';
  } catch(error) {
    status.textContent = 'Formatter unavailable';
    display('E_FORMAT: ' + String(error?.message || error), 'error');
  } finally {
    formatting = false;
    editor.readOnly = working;
    selector.disabled = working;
    runButton.disabled = working || PREVIEW_EXAMPLES.has(selector.value);
    formatButton.disabled = checkFormatButton.disabled = working || PREVIEW_EXAMPLES.has(selector.value);
  }
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
formatButton.addEventListener('click', () => formatCode(false));
checkFormatButton.addEventListener('click', () => formatCode(true));
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
