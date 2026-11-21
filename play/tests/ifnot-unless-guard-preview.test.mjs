// Source/catalog checks only: no compiled Rust/Wasm guest verification.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {tokenizeAtto} from '../src/syntax-highlight.js';

const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');

test('ifnot/unless/guard preview is registered once and remains diagnostic-only', async () => {
  const [source, html, app, release, catalog, profileText] = await Promise.all([
    read('examples/preview/ifnot-unless-guard.atto'),
    read('index.html'),
    read('src/app.js'),
    read('../.github/scripts/package-playground.mjs'),
    read('tests/example-catalog.test.mjs'),
    read('example-backend-profile.json')
  ]);
  assert.match(source, /^\/\/ SYNTAX PREVIEW — NOT browser-lowered\./);
  for (const fragment of [
    'do ifnot ready then',
    'do unless authorized then',
    'ifnot value >= 0 {',
    'unless value < 100 {',
    'guard value > 0 {',
    'return -50;',
    'ifnot ready then 1 else 2 fi',
    'unless authorized then 3 else 4 fi',
    'INVALID: guard ready',
    'pub fnc main(): int'
  ]) assert.ok(source.includes(fragment), 'Missing source form: ' + fragment);

  const profile = JSON.parse(profileText);
  assert.deepEqual(profile.preview.find(entry => entry.name === 'ifnot-unless-guard'),
    {name:'ifnot-unless-guard', expect:'preview-only'});
  const availableLine = app.split('\n').find(line => line.startsWith('const PREVIEW_EXAMPLES ='));
  const runnableLine = app.split('\n').find(line => line.startsWith('const EXECUTABLE_PREVIEWS ='));
  const available = JSON.parse(availableLine.slice(availableLine.indexOf('['), availableLine.indexOf(']') + 1));
  const executable = JSON.parse(runnableLine.slice(runnableLine.indexOf('['), runnableLine.indexOf(']') + 1));
  assert.equal(available.filter(name => name === 'preview/ifnot-unless-guard').length, 1);
  assert.ok(!executable.includes('preview/ifnot-unless-guard'));
  assert.equal(html.split('value="preview/ifnot-unless-guard"').length - 1, 1);
  const syntaxGroup = html.split('Language previews — syntax only (compiler diagnostics)')[1].split('</optgroup>')[0];
  assert.ok(syntaxGroup.includes('value="preview/ifnot-unless-guard"'));
  assert.equal(release.split("'examples/preview/ifnot-unless-guard.atto'").length - 1, 1);
  assert.ok(catalog.includes('"ifnot-unless-guard"'));

  const tokens = tokenizeAtto(source);
  assert.equal(tokens.map(token => token.text).join(''), source);
  for (const word of ['ifnot','unless','guard'])
    assert.ok(tokens.some(token => token.text === word && token.kind === 'keyword'), word);
});
