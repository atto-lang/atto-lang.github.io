import test from 'node:test';
import assert from 'node:assert/strict';
import { installProgramPicker } from '../src/program-picker.js';

function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function element(initial = '') {
  const listeners = new Map();
  return {
    value: initial, hidden: false, textContent: '',
    addEventListener(name, listener) {
      if (!listeners.has(name)) listeners.set(name, []);
      listeners.get(name).push(listener);
    },
    dispatchEvent(event) {
      for (const listener of listeners.get(event.type) || []) listener(event);
    },
    replaceChildren() {},
  };
}
function setup(loadSample) {
  globalThis.window = { localStorage: { getItem: () => null } };
  const selector = element('hello'), editor = element(),
    nameInput = element(), saveButton = element(), deleteButton = element(),
    savedGroup = element(), status = element();
  const picker = installProgramPicker({
    selector, editor, nameInput, saveButton, deleteButton,
    savedGroup, status, loadSample,
  });
  const select = value => {
    selector.value = value;
    selector.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const type = value => {
    editor.value = value;
    editor.dispatchEvent(new Event('input', { bubbles: true }));
  };
  return { picker, selector, editor, status, select, type };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test('failed stale sample request cannot override newer Fibonacci selection', async () => {
  const first = deferred();
  const ui = setup(name => name === 'fib' ? first.promise : Promise.resolve('// ' + name));
  await ui.picker.initialize();
  ui.select('fib');
  ui.select('fib-match');
  await flush();
  assert.equal(ui.selector.value, 'fib-match');
  assert.equal(ui.editor.value, '// fib-match');
  first.reject(new Error('offline'));
  await flush();
  assert.equal(ui.selector.value, 'fib-match');
  assert.equal(ui.editor.value, '// fib-match');
  assert.equal(ui.status.textContent, 'Ready');
});

test('typing while a sample loads cancels it without losing user source', async () => {
  const pending = deferred();
  const ui = setup(name => name === 'fib-match' ? pending.promise : Promise.resolve('// ' + name));
  await ui.picker.initialize();
  ui.select('fib-match');
  ui.type('my unsaved Atto code');
  pending.resolve('// returned too late');
  await flush();
  assert.equal(ui.selector.value, 'hello');
  assert.equal(ui.editor.value, 'my unsaved Atto code');
  assert.match(ui.status.textContent, /Sample load canceled/);
});

test('genuine latest sample failure preserves source and reports a load error', async () => {
  const pending = deferred();
  const ui = setup(name => name === 'fib-match' ? pending.promise : Promise.resolve('// ' + name));
  await ui.picker.initialize();
  ui.select('fib-match');
  pending.reject(new Error('network unavailable'));
  await flush();
  assert.equal(ui.selector.value, 'hello');
  assert.equal(ui.editor.value, '// hello');
  assert.match(ui.status.textContent, /Cannot load program: network unavailable/);
});
