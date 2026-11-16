// Browser host admission gate for the non-suspending stdio.out profile.
// Rust/Atto compiler and native asynchronous-drain conformance are separate.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STDOUT_LIMIT, appendAccepted, appendCapped, stdoutAdmissionBudget,
  guestImports, describePanic
} from '../src/guest.js';

test('stdout admission is synchronous and ordered, not an OS drain receipt', () => {
  const out = { text: '', truncated: false };
  assert.equal(appendAccepted(out, 'Hello'), undefined);
  assert.equal(appendAccepted(out, ' world'), undefined);
  assert.equal(out.text, 'Hello world');
  assert.equal(out.truncated, false);
  assert.equal(stdoutAdmissionBudget(out).used, 11);
});

test('quota failure is atomic, explicit, and never sets a false success', () => {
  const out = { text: '', truncated: false };
  appendAccepted(out, 'x'.repeat(STDOUT_LIMIT - 1));
  assert.throws(() => appendAccepted(out, 'AB'), /E_STDOUT_QUOTA/);
  assert.equal(out.text.length, STDOUT_LIMIT - 1);
  assert.equal(stdoutAdmissionBudget(out).used, STDOUT_LIMIT - 1);
  assert.equal(out.truncated, false);
  appendAccepted(out, 'z');
  assert.equal(out.text.at(-1), 'z');
  assert.equal(stdoutAdmissionBudget(out).used, STDOUT_LIMIT);
  assert.throws(() => appendAccepted(out, '!'), /E_STDOUT_QUOTA/);
});

test('quota refuses whole UTF-16 message including surrogate pairs', () => {
  const out = { text: '', truncated: false };
  appendAccepted(out, 'x'.repeat(STDOUT_LIMIT - 1));
  assert.throws(() => appendAccepted(out, '🚀'), /E_STDOUT_QUOTA/);
  assert.equal(out.text, 'x'.repeat(STDOUT_LIMIT - 1));
  appendAccepted(out, '!');
  assert.equal(out.text.length, STDOUT_LIMIT);
});

test('shared budget prevents separate actors from over-admitting tenant output', () => {
  const outer = { text: '', truncated: false };
  const budget = stdoutAdmissionBudget(outer);
  const actor1 = { text: '', truncated: false, stdoutAdmission: budget };
  const actor2 = { text: '', truncated: false, stdoutAdmission: budget };
  appendAccepted(actor1, 'A'.repeat(STDOUT_LIMIT - 2));
  assert.throws(() => appendAccepted(actor2, 'BBB'), /E_STDOUT_QUOTA/);
  assert.equal(actor2.text, '');
  assert.equal(budget.used, STDOUT_LIMIT - 2);
  appendAccepted(actor2, 'B');
  appendAccepted(actor2, 'C');
  appendCapped(outer, actor1.text);
  appendCapped(outer, actor2.text);
  assert.equal(outer.text.length, STDOUT_LIMIT);
  assert.equal(outer.text.at(-2), 'B');
  assert.equal(outer.text.at(-1), 'C');
  assert.equal(outer.truncated, false);
});

test('closed and truncated output reject future admission without modifying payload', () => {
  const out = { text: 'previous', truncated: false, closed: true };
  assert.throws(() => appendAccepted(out, 'new'), /E_STDOUT_CLOSED/);
  assert.equal(out.text, 'previous');
  const truncated = { text: 'previous', truncated: true };
  assert.throws(() => appendAccepted(truncated, 'new'), /E_STDOUT_QUOTA/);
  assert.equal(truncated.text, 'previous');
});

const section = (id, bytes) => [id, ...leb(bytes.length), ...bytes];
function leb(value) {
  const out = [];
  do {
    let digit = value & 127;
    value >>>= 7;
    if (value) digit |= 128;
    out.push(digit);
  } while (value);
  return out;
}
const str = word => [...leb(word.length), ...new TextEncoder().encode(word)];

// A real Wasm module importing atto.print_i64, invoking it with i64(42),
// then returning i64(7). No mocked compiler or dynamically evaluated guest JS.
function makeGuest() {
  const t = [2, 0x60, 1, 0x7e, 0, 0x60, 0, 1, 0x7e];
  const imp = [1, ...str('atto'), ...str('print_i64'), 0, 0];
  const fn = [1, 1];
  const ex = [1, ...str('main'), 0, 1];
  const body = [0, 0x42, 42, 0x10, 0, 0x42, 7, 0x0b];
  const code = [1, ...leb(body.length), ...body];
  return new WebAssembly.Module(new Uint8Array([
    0, 97, 115, 109, 1, 0, 0, 0,
    ...section(1, t), ...section(2, imp), ...section(3, fn),
    ...section(7, ex), ...section(10, code)
  ]));
}

test('real Wasm host import enqueues output without awaiting the consumer', () => {
  const module = makeGuest();
  const out = { text: '', truncated: false };
  const { imports, bind } = guestImports(module, out);
  const guest = new WebAssembly.Instance(module, imports);
  bind(guest);
  assert.equal(guest.exports.main(), 7n);
  assert.equal(out.text, '42');
  assert.equal(out.truncated, false);
});

test('real Wasm host import throws explicit quota error; no partial admission', () => {
  const module = makeGuest();
  const out = { text: 'x'.repeat(STDOUT_LIMIT - 1), truncated: false };
  const { imports, bind } = guestImports(module, out);
  const guest = new WebAssembly.Instance(module, imports);
  bind(guest);
  assert.throws(() => guest.exports.main(), /E_STDOUT_QUOTA/);
  assert.equal(out.text, 'x'.repeat(STDOUT_LIMIT - 1));
  assert.equal(out.truncated, false);
  assert.equal(stdoutAdmissionBudget(out).used, STDOUT_LIMIT - 1);
});
