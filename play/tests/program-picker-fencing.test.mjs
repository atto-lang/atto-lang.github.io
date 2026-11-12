import test from 'node:test';
import assert from 'node:assert/strict';
import { installProgramPicker } from '../src/program-picker.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((good, bad) => { resolve = good; reject = bad; });
  return { promise, resolve, reject };
}
function element(value = '') {
  const target = new EventTarget();
  target.value = value;
  target.hidden = false;
  target.textContent = '';
  target.replaceChildren = (...children) => { target.children = children; };
  return target;
}
function setup(t, loadSample) {
  const oldWindow = globalThis.window;
  globalThis.window = { localStorage: { getItem: () => null, setItem() {} }, confirm: () => true };
  t.after(() => { if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow; });
  const selector = element('hello'), editor = element(), status = element();
  const states = [];
  const picker = installProgramPicker({
    selector, editor, status, loadSample,
    nameInput: element(), saveButton: element(), deleteButton: element(),
    savedGroup: element(),
    onSelectionChange: loading => states.push(loading)
  });
  return {
    selector, editor, status, states,
    async initialize() { await picker.initialize(); states.length = 0; },
    select(name) {
      selector.value = name;
      selector.dispatchEvent(new Event('change'));
    },
    type(source) {
      editor.value = source;
      editor.dispatchEvent(new Event('input'));
    }
  };
}

test('pending sample invalidates immediately and late success cannot overwrite typed source', async t => {
  const held = deferred();
  const h = setup(t, name => name === 'trap' ? held.promise : Promise.resolve('// ' + name));
  await h.initialize();
  h.select('trap');
  assert.deepEqual(h.states, [true], 'parent must revoke executable bytes before fetch completes');
  assert.equal(h.editor.value, '// hello');
  h.type('pub fnc main(): int { return 21; }');
  assert.equal(h.selector.value, 'hello');
  assert.deepEqual(h.states, [true, false]);
  held.resolve('// stale trap sample');
  await tick();
  assert.equal(h.editor.value, 'pub fnc main(): int { return 21; }');
  assert.equal(h.status.textContent, 'Ready');
  assert.deepEqual(h.states, [true, false], 'stale completion cannot re-enable or change state');
});

test('late rejected sample cannot restore obsolete dropdown or clobber new state', async t => {
  const held = deferred();
  const h = setup(t, name => name === 'trap' ? held.promise : Promise.resolve('// ' + name));
  await h.initialize();
  h.select('trap');
  h.select('result-option');
  await tick();
  assert.equal(h.editor.value, '// result-option');
  assert.equal(h.selector.value, 'result-option');
  assert.deepEqual(h.states, [true, true, false]);
  held.reject(new Error('stale simulated network error'));
  await tick();
  assert.equal(h.editor.value, '// result-option');
  assert.equal(h.selector.value, 'result-option');
  assert.equal(h.status.textContent, 'Ready');
  assert.deepEqual(h.states, [true, true, false], 'old rejection cannot change new selection');
});

test('a failed current sample restores the prior selection and releases loading gate', async t => {
  const h = setup(t, name => name === 'trap'
    ? Promise.reject(new Error('simulated download failure'))
    : Promise.resolve('// ' + name));
  await h.initialize();
  h.select('trap');
  assert.deepEqual(h.states, [true]);
  await tick();
  assert.equal(h.selector.value, 'hello');
  assert.equal(h.editor.value, '// hello');
  assert.match(h.status.textContent, /Cannot load program: simulated download failure/);
  assert.deepEqual(h.states, [true, false]);
});
