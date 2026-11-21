// This test describes a candidate fixture, not an executable pinned-browser claim.
// The playground must stay preview-only until the exact compiler bytes are built,
// guest-executed, proven against negative cases and approved for release.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = file => readFile(new URL('../' + file, import.meta.url), 'utf8');

test('owned Dyn candidate uses supported constructor/stdout syntax and remains preview-only', async () => {
  const [source, app, profileText] = await Promise.all([
    read('examples/preview/dyn-interfaces.atto'),
    read('src/app.js'),
    read('example-backend-profile.json')
  ]);
  const profile = JSON.parse(profileText);
  const executable = JSON.parse(
    app.match(/const EXECUTABLE_PREVIEWS = new Set\((\[[^\n]+\])\)/)[1]
  );
  assert.match(source, /^\/\/ SYNTAX PREVIEW — NOT browser-lowered/);
  assert.match(source, /define pub interface Printable as/);
  assert.match(source, /define class Greeting implements Printable as/);
  assert.match(source, /val Greeting concrete = new Greeting\(\);/);
  assert.match(source, /val Dyn<Printable> erased = Dyn<Printable>\(take! concrete\);/);
  assert.match(source, /return item\.describe\(\);/);
  assert.match(source, /stdio\.println\(display\(erased\)\);/);
  assert.doesNotMatch(source, /display\(erased\)\.length/);
  assert.ok(!executable.includes('preview/dyn-interfaces'),
    'never promote Dyn without a validated pinned compiler and executed guest oracle');
  assert.deepEqual(profile.preview.find(({name}) => name === 'dyn-interfaces'),
    {name: 'dyn-interfaces', expect: 'preview-only'});
  for (const negative of [
    'INVALID: concrete.describe()',
    'INVALID: val Dyn<Printable> forged',
    'INVALID: erased.secret_field',
    'INVALID: send_to_other_tenant(erased)'
  ]) assert.ok(source.includes(negative), negative);
});
