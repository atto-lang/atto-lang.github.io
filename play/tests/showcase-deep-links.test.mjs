import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const home = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
const profile = JSON.parse(await readFile(new URL('../example-backend-profile.json', import.meta.url), 'utf8'));
const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
const picker = await readFile(new URL('../src/program-picker.js', import.meta.url), 'utf8');

test('homepage showcases every and only guest-verified language program', () => {
  const verified = profile.preview.filter(row => row.expect === 'exec').map(row => row.name).sort();
  const linked = [...home.matchAll(/href="\.\/play\/\?example=preview\/([a-z-]+)&amp;run=1"/g)]
    .map(match => match[1]).sort();
  assert.equal(verified.length, 23, 'public showcase count must match executable oracle');
  assert.deepEqual(linked, verified, 'showcase must not advertise syntax-only programs for execution');
  assert.match(home, /id="showcase"/);
  assert.match(home, /href="#showcase">Runnable showcase/);
  assert.match(home, /23 real AttoLang programs you can run/);
});

test('deep-link bootstrap restricts source and autorun to the verified manifest', () => {
  assert.match(app, /EXECUTABLE_PREVIEWS\.has\(linkedExample\)/);
  assert.match(app, /shared === null && verifiedExample && entryParams\.get\('run'\) === '1'/);
  assert.match(app, /selector\.value === verifiedExample\) run\(\)/);
  assert.match(app, /smoke === '1' && shared === null && !entryParams\.has\('example'\)/);
  assert.match(picker, /async initialize\(sharedCode = null, initialSample = 'hello'\)/);
  assert.match(picker, /await choose\(initialSample\)/);
  assert.match(app, /if \(!EXAMPLES\.includes\(name\)\) throw new Error\('unknown example'\)/);
});
