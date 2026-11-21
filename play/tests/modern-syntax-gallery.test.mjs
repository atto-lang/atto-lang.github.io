// Source-only checks. These previews do NOT certify compiler or browser guest support.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const entries = {
  "pkg-import-forms": [
    "import pkg 'telemetry';",
    "import module math",
    "import * as helpers"
  ],
  "core-alloc-stdlib": [
    "import pkg 'core.option'",
    "import pkg 'alloc.collections'",
    "import pkg 'std.http'"
  ],
  "collections-inline-literals": [
    "List<int>",
    "Array<int>",
    "Map<string, int>",
    "{answer: 42"
  ],
  "struct-record-pair-entry": [
    "define struct",
    "define record",
    "Tuple<int, string>",
    "Pair.of(",
    "Entry.of(",
    "=>"
  ],
  "browser-websocket-client": [
    "wss://",
    "await websocket.connect",
    "socket.receive()"
  ],
  "javascript-package-interop": [
    "pkg 'npm:date-fns'",
    "format_iso_date"
  ],
  "result-question-mark": [
    "int.parse(text)?",
    "input?",
    "Result<int, Error>"
  ],
  "exception-unwind-hooks": [
    "catch (Error e)",
    "finally {",
    "recover (",
    "panic"
  ],
  "typed-supervisor-notices": [
    "receives int",
    "sends string",
    "ActorMail<int>",
    "ChildFailureNotice",
    "CONTROL"
  ],
  "ownership-bang-operators": [
    "borrow! mut",
    "take!",
    "share!",
    "copy!",
    "copy!!"
  ],
  "tenantvm-capability-boundaries": [
    "TenantVM",
    "socket",
    "receives string"
  ],
  "async-select-cancellation": [
    "select<int>",
    "readch queue",
    "timeout(100ms)"
  ],
  "gpu-simd-collections": [
    "layout=soa",
    "layout=aos",
    "gpu {",
    "cpu {"
  ]
};
const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');

test('new modern syntax previews are documented and correctly packaged', async () => {
  const [profileText, html, app, packageScript, catalog] = await Promise.all([
    read('example-backend-profile.json'), read('index.html'), read('src/app.js'),
    read('../.github/scripts/package-playground.mjs'), read('tests/example-catalog.test.mjs')
  ]);
  const profile = JSON.parse(profileText);
  for (const [slug, tags] of Object.entries(entries)) {
    const file = 'examples/preview/' + slug + '.atto';
    const contents = await read(file);
    if (slug === 'exception-unwind-hooks') {
      assert.match(contents, /^\/\/ LANGUAGE PREVIEW — compiles and runs in this browser playground/);
      assert.deepEqual(profile.preview.find(x => x.name === slug),
        {name: slug, expect: 'exec', return: '42', stdout: 'finally\ncleanup\n'});
    } else {
      assert.match(contents, /^\/\/ SYNTAX PREVIEW — NOT browser-lowered/);
    }
    assert.match(contents, /pub fnc main\(\)/);
    assert.match(contents, /^\/\/ INVALID:/m);
    for (const tag of tags) assert.ok(contents.includes(tag), slug + ': missing ' + tag);
    assert.equal(profile.preview.filter(x => x.name === slug && x.expect === (slug === 'exception-unwind-hooks' ? 'exec' : 'preview-only')).length, 1);
    assert.equal(html.split('value="preview/' + slug + '"').length - 1, 1);
    assert.equal(app.split('"preview/' + slug + '"').length - 1, 1);
    assert.equal(packageScript.split("'" + file + "'").length - 1, 1);
    assert.ok(catalog.includes('"' + slug + '"'), slug + ': catalog absent');
  }
});

test('browser and supervisor samples deny ambient grants or forged control', async () => {
  for (const name of ['browser-websocket-client', 'javascript-package-interop',
                      'typed-supervisor-notices', 'tenantvm-capability-boundaries']) {
    const source = await read('examples/preview/' + name + '.atto');
    assert.match(source, /INVALID:/);
    assert.match(source, /tenant|capabilit|CONTROL/i);
  }
});
