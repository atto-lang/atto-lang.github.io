// Static evidence only: these are language-contract sketches, not compiler acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');
const cases = new Map([
  ['borrow-disjoint-fields', ['borrow! person.name', 'borrow! mut person.age', 'take! person']],
  ['borrow-nll-control-flow', ['left_view', 'select_left', 'defer', 'last *possible* use']],
  ['borrow-method-effects', ['increment_total', 'verified disjoint effects', 'unknown callback']],
  ['borrow-actor-state-projections', [
    'Meter mut self.state.counter',
    'Meter mut self.state.{counter, xyz}',
    'critical-write', 'critical-read', 'no parallel writers implied'
  ]]
]);

test('all advanced borrow cases are catalogued, packaged and explicitly diagnostic-only', async () => {
  const [html, app, profile, release, audit, catalog] = await Promise.all([
    read('index.html'), read('src/app.js'), read('example-backend-profile.json').then(JSON.parse),
    read('../.github/scripts/package-playground.mjs'),
    read('../.github/scripts/audit-live-playground.mjs'),
    read('tests/example-catalog.test.mjs')
  ]);
  const preview = JSON.parse(app.match(/const PREVIEW_EXAMPLES = new Set\\((\\[[^\\n]+\\])\\)/)[1]);
  const executable = JSON.parse(app.match(/const EXECUTABLE_PREVIEWS = new Set\\((\\[[^\\n]+\\])\\)/)[1]);
  const group = html.match(/<optgroup label="Language previews — syntax only \\(compiler diagnostics\\)">([\\s\\S]*?)<\\/optgroup>/);
  assert.ok(group, 'syntax-only dropdown group missing');
  for (const name of cases.keys()) {
    const id = 'preview/' + name;
    assert.equal(preview.filter(value => value === id).length, 1, name + ' registered once');
    assert.equal(html.split('value="' + id + '"').length - 1, 1, name + ' dropdown once');
    assert.ok(group[1].includes('value="' + id + '"'), name + ' not in syntax-only group');
    assert.equal(executable.includes(id), false, name + ' prematurely advertised as executable');
    assert.deepEqual(profile.preview.find(value => value.name === name),
      { name, expect: 'preview-only' });
    assert.equal(release.split("'examples/preview/" + name + ".atto'").length - 1, 1,
      name + ' must be on protected asset allowlist once');
    assert.ok(catalog.includes('"' + name + '"'), name + ' missing from catalog inventory');
  }
  assert.ok(audit.includes("'/play/tests/advanced-borrow-previews.test.mjs'"),
    'new internal regression file must be denied by production HTTP postflight');
});

test('the advanced examples explain conflicting borrows and never execute bad cases', async () => {
  for (const [name, tokens] of cases) {
    const source = await read('examples/preview/' + name + '.atto');
    assert.match(source, /^\\/\\/ SYNTAX PREVIEW — NOT browser-lowered/);
    assert.match(source, /pub fnc main\\(\\): int/);
    assert.match(source, /NOT browser|NOT pinned|NOT browser-lowered|NOT browser execution|not browser|unverified|target/i);
    const invalid = source.split('\\n').filter(line => line.includes('INVALID:'));
    assert.ok(invalid.length >= 5, name + ' must include at least five negative examples');
    for (const line of invalid) assert.match(line, /^\\s*\\/\\/ INVALID:/,
      name + ' accidentally activated an invalid example');
    for (const token of tokens) assert.ok(source.includes(token), name + ' lacks '+token);
    assert.doesNotMatch(source, /<script\\b|^#include\\b/m);
  }
});

test('actor state permissions are not confused with independently lockable fields', async () => {
  const source = await read('examples/preview/borrow-actor-state-projections.atto');
  assert.match(source, /STATIC write-permission ceiling/);
  assert.match(source, /whole-state exclusive critical-write/);
  assert.match(source, /INVALID: self.state.counter \\+= 1/);
  assert.match(source, /INVALID: await next_value\\(\\)/);
  assert.match(source, /INVALID:.*s\\.other/);
});
