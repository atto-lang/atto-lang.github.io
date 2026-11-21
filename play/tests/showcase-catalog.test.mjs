import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');
const profile = JSON.parse(await read('example-backend-profile.json'));
const names = profile.preview.filter(p => p.expect === 'exec').map(p => p.name).sort();

test('the static showcase offers only executed, exact-oracle Atto programs', async () => {
  const [page, playground, app, picker, release, audit, styles] = await Promise.all([
    read('showcase/index.html'), read('index.html'), read('src/app.js'),
    read('src/program-picker.js'), read('../.github/scripts/package-playground.mjs'),
    read('../.github/scripts/audit-live-playground.mjs'), read('showcase/styles.css')
  ]);
  const cards = [...page.matchAll(/data-example="preview\/([a-z0-9-]+)"/g)].map(m => m[1]).sort();
  assert.equal(names.length, 28, 're-review executable membership changes');
  assert.deepEqual(cards, names, 'syntax-only examples cannot be called executable');
  assert.ok(cards.includes('bitwise'), 'real bitwise guest must have a showcase card');
  for (const name of names) {
    const oracle = profile.preview.find(p => p.name === name);
    assert.ok(page.includes('href="../?example=preview%2F' + name + '&amp;run=1"'), name + ' run link');
    assert.ok(page.includes('href="../examples/preview/' + name + '.atto"'), name + ' source link');
    assert.ok(page.includes('>' + oracle.return + '</code>'), name + ' exact return oracle');
  }
  assert.match(page, /Content-Security-Policy/);
  assert.doesNotMatch(page, /<script|<iframe|onerror=|onclick=|javascript:/i);
  assert.doesNotMatch(styles, /@import|url\s*\(/i);
  assert.match(playground, /href="\.\/showcase\/"/);
  const homepage = await read('../index.html');
  assert.match(homepage, /href="\.\/play\/showcase\/"/);
  assert.match(homepage, /href="\.\/play\/"/);
  assert.match(homepage, /28 runnable programs/);
  assert.doesNotMatch(homepage, /<script|<iframe|onerror=|onclick=|javascript:/i);
  assert.match(picker, /initialize\(sharedCode = null, initialSample = 'hello'\)/);
  assert.match(app, /EXECUTABLE_PREVIEWS\.has\(linkedExample\)/);
  assert.match(app, /EXECUTABLE_PREVIEWS\.has\(linkedExample\)/);
  assert.match(app, /shared === null/);
  for (const path of ['showcase/index.html','showcase/styles.css'])
    assert.equal(release.split("'" + path + "'").length - 1, 1, 'protected release allowlist: ' + path);
  assert.ok(audit.includes("'/play/tests/showcase-catalog.test.mjs'"));
  assert.ok(!release.includes("'tests/showcase-catalog.test.mjs'"));
});
