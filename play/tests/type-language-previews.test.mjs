// Static teaching-contract tests: do not claim that a pinned compiler executes previews.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');
const names = ["dyn-interfaces","box-ownership","arc-sharing","sends-capabilities","atomic-ordering","weak-pin-lifetimes"];
const tokens = {
  "dyn-interfaces": [
    "Dyn<Printable>",
    "take! concrete",
    "interface Printable",
    "INVALID: concrete.describe()",
    "not arbitrary access",
    "TenantVM"
  ],
  "box-ownership": [
    "Box<int>",
    "borrow! owner",
    "borrow! mut owner",
    "take! owner",
    "drop! next",
    "double drop"
  ],
  "arc-sharing": [
    "Arc<string>",
    "share! first",
    "share! second",
    "transitively immutable",
    "Strong cycles",
    "TenantVMs"
  ],
  "sends-capabilities": [
    "Sends<int>",
    "receives int sends string",
    "T: Send/Sendable",
    "Serializable",
    "Result<void, Error>",
    "worker.sender<int>()",
    "INVALID:"
  ],
  "atomic-ordering": [
    "Arc<Atomic<int>>",
    "share! counter",
    "fetch_add(1, Ordering.seq_cst)",
    "INVALID: peer.value",
    "cross-Worker/tenant"
  ],
  "weak-pin-lifetimes": [
    "Weak<int>",
    "Pin<Box<int>>",
    "weak! shared",
    "pin! take! owned",
    "observer.upgrade()",
    "None",
    "cross-domain"
  ]
};

test('focused type previews are wired into the diagnostic-only catalog and protected release', async () => {
  const [html, app, profileFile, catalog, packageFile] = await Promise.all([
    read('index.html'), read('src/app.js'), read('example-backend-profile.json'),
    read('tests/example-catalog.test.mjs'), read('../.github/scripts/package-playground.mjs')
  ]);
  const profile = JSON.parse(profileFile);
  const configured = JSON.parse(app.match(/const PREVIEW_EXAMPLES = new Set\((\[[^\n]+\])\)/)[1]);
  const executable = JSON.parse(app.match(/const EXECUTABLE_PREVIEWS = new Set\((\[[^\n]+\])\)/)[1]);
  const group = html.match(/<optgroup label="Language previews — syntax only \(compiler diagnostics\)">([\s\S]*?)<\/optgroup>/);
  assert.ok(group, 'target group must exist');
  for (const name of names) {
    const id = 'preview/' + name;
    assert.equal(html.split('value="' + id + '"').length - 1, 1);
    assert.ok(group[1].includes('value="' + id + '"'), name + ' must not be in executable showcase');
    assert.equal(configured.filter(x => x === id).length, 1);
    assert.ok(!executable.includes(id), name + ' cannot be promoted by the UI');
    assert.deepEqual(profile.preview.find(x => x.name === name), {name, expect:'preview-only'});
    assert.equal(packageFile.split("'examples/preview/" + name + ".atto'").length - 1, 1);
    assert.ok(catalog.includes('"' + name + '"'), name + ' missing from complete inventory');
  }
});

test('Dyn/Box/Arc/Sends/Atomic/Weak/Pin previews retain safety constraints', async () => {
  for (const name of names) {
    const source = await read('examples/preview/' + name + '.atto');
    assert.match(source, /^\/\/ SYNTAX PREVIEW — NOT browser-lowered/);
    assert.match(source, /pub (?:spawns )?fnc main\(\): int/);
    assert.match(source, /^\s*\/\/ INVALID:/m, name + ' needs an explicit negative example');
    assert.match(source, /proposed|PROPOSED|under review|need spec approval/i);
    assert.doesNotMatch(source, /<script\b|^#include\b/m);
    for (const token of tokens[name]) assert.ok(source.includes(token), name + ': ' + token);
    // Negative example lines stay commented: no accidentally runnable invalid source.
    for (const line of source.split('\n').filter(line => line.includes('INVALID:')))
      assert.match(line, /^\s*\/\/ INVALID:/);
  }
});
