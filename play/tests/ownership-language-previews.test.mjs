// Static source and release-boundary contract checks; NOT native/browser guest proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');
const required = {
  "borrow-typed": [
    "Borrow<Packet>",
    "inspect(packet)",
    "inspect(borrow! packet)",
    "borrow! packet",
    "take! packet",
    "no new owner"
  ],
  "borrow-lifetimes": [
    "lt! a",
    "Borrow<T, lt=a>",
    "choose_first",
    "dangling",
    "await",
    "owner"
  ],
  "borrow-mut": [
    "mut Counter",
    "borrow! mut counter",
    "increment(mut counter)",
    "readonly",
    "overlap"
  ],
  "borrow-suspension": [
    "suspends fnc",
    "await next_value()",
    "borrow! payload",
    "pin!",
    "await",
    "cancellation"
  ],
  "sendable-serializable": [
    "Sendable",
    "Serializable",
    "receives int",
    "ActorMail<int>",
    "send(",
    "TenantVM",
    "Result"
  ],
  "freeze-share": [
    "freeze! take!",
    "share! frozen",
    "share! shared",
    "immutable",
    "alias",
    "tenant"
  ],
  "copy-deep-copy": [
    "copy! scalar",
    "copy!! original",
    "deep graph",
    "cycles",
    "alias topology",
    "rollback"
  ],
  "shared-rwlock": [
    "RwLock(",
    "share! state",
    "with_read(",
    "with_write(",
    "|mut counter|",
    "await",
    "TenantVM"
  ]
};

// borrow-suspension compiles and runs since the atto.task.v1 compiler pin.
const graduated = new Set(['borrow-suspension']);

test('all eight ownership tutorials are catalogued as diagnostic-only', async () => {
  const [html, app, profileFile, catalog, packager, audit] = await Promise.all([
    read('index.html'), read('src/app.js'), read('example-backend-profile.json'),
    read('tests/example-catalog.test.mjs'), read('../.github/scripts/package-playground.mjs'),
    read('../.github/scripts/audit-live-playground.mjs')
  ]);
  const profile = JSON.parse(profileFile);
  const previews = JSON.parse(app.match(/const PREVIEW_EXAMPLES = new Set\((\[[^\n]+\])\)/)[1]);
  const runnable = JSON.parse(app.match(/const EXECUTABLE_PREVIEWS = new Set\((\[[^\n]+\])\)/)[1]);
  const group = html.match(/<optgroup label="Language previews — syntax only \(compiler diagnostics\)">([\s\S]*?)<\/optgroup>/);
  assert.ok(group, 'diagnostic-only preview group missing');
  const names = Object.keys(required);
  assert.equal(names.length, 8);
  for (const name of names.filter(n => graduated.has(n))) {
    const id = 'preview/' + name;
    assert.ok(!group[1].includes('value="' + id + '"'), name + ' graduated to the executable showcase');
    assert.ok(runnable.includes(id), name + ' must be registered executable');
    assert.equal(profile.preview.find(x => x.name === name)?.expect, 'exec', name + ' needs an exact oracle');
  }
  for (const name of names.filter(n => !graduated.has(n))) {
    const id = 'preview/' + name;
    assert.equal(html.split('value="' + id + '"').length - 1, 1);
    assert.ok(group[1].includes('value="' + id + '"'), name + ' must stay diagnostic-only');
    assert.equal(previews.filter(x => x === id).length, 1, name + ' registered once');
    assert.ok(!runnable.includes(id), name + ' must not be called executable');
    assert.deepEqual(profile.preview.find(x => x.name === name), {name,expect:'preview-only'});
    assert.ok(catalog.includes('"' + name + '"'), name + ' missing from complete catalog');
    assert.equal(packager.split("'examples/preview/" + name + ".atto'").length - 1, 1,
      name + ' not on the protected release allowlist');
  }
  assert.ok(audit.includes("'/play/tests/ownership-language-previews.test.mjs'"),
    'new internal test source must be explicitly denied to public HTTP');
});

test('ownership samples display checked constraints and negative cases', async () => {
  for (const [name, tokens] of Object.entries(required)) {
    const source = await read('examples/preview/' + name + '.atto');
    if (graduated.has(name)) {
      assert.match(source, /^\/\/ LANGUAGE PREVIEW — compiles and runs in this browser playground\./);
    } else {
      assert.match(source, /^\/\/ SYNTAX PREVIEW — NOT browser-lowered/);
      assert.match(source, /not browser|NOT browser|unverified|target/i);
    }
    assert.match(source, /pub suspends? fnc main\(\)|pub fnc main\(\)/);
    assert.ok((source.match(/^\s*\/\/ INVALID:/gm) || []).length >= 3,
      name + ' must teach at least three rejecting mutations');
    for (const token of tokens) assert.ok(source.includes(token), name + ': '+token);
    for (const line of source.split('\n').filter(x => x.includes('INVALID:'))) {
      assert.match(line, /^\s*\/\/ INVALID:/, name + ' has live invalid source');
    }
    assert.doesNotMatch(source, /<script\b|^#include\b/m);
  }
});

test('borrow and cross-tenant previews never authorize ambient privilege', async () => {
  const [borrow, transfer, shared, lock] = await Promise.all([
    read('examples/preview/borrow-typed.atto'),
    read('examples/preview/sendable-serializable.atto'),
    read('examples/preview/freeze-share.atto'),
    read('examples/preview/shared-rwlock.atto')
  ]);
  assert.match(borrow, /no new owner/);
  assert.match(transfer, /neither implies the other/);
  assert.match(transfer, /TenantVM/);
  assert.match(shared, /tenant boundary/);
  assert.match(lock, /TenantVM/);
  assert.match(lock, /cannot suspend/);
});
