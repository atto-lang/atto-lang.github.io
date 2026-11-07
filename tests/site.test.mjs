import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const home = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const play = await readFile(new URL('../play/index.html', import.meta.url), 'utf8');
test('homepage navigates to local playground landing', () => {
  assert.match(home, /href="\.\/play\/"/);
  assert.match(home, /fnc main\(\) -&gt; int/);
  assert.match(home, /not yet supported/);
});
test('playground landing links to planned exact project URL without claiming deployment', () => {
  assert.match(play, /https:\/\/atto-lang\.github\.io\/atto-playground\//);
  assert.match(play, /only after the playground PR, Pages deployment and public URL have been verified/);
  assert.match(play, /experimental M0/i);
});
test('both pages have explicit privacy/CSP policy and no scripts or iframes', () => {
  for (const html of [home, play]) {
    assert.match(html, /http-equiv="Content-Security-Policy"/);
    assert.match(html, /default-src 'none'/);
    assert.doesNotMatch(html, /<script\b|<iframe\b|javascript:/i);
    assert.match(html, /<html lang="en">/);
  }
});
