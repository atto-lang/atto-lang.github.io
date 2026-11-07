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

test('Pages publishing is main-push-only, exact-head and symlink-safe', async () => {
  const workflow = await readFile(new URL('../.github/workflows/pages.yml', import.meta.url), 'utf8');
  assert.match(workflow, /branches: \[main\]/);
  assert.doesNotMatch(workflow, /workflow_dispatch:/);
  assert.match(workflow, /if: github\.ref == 'refs\/heads\/main' && github\.event_name == 'push'/);
  assert.match(workflow, /test "\$\(git rev-parse HEAD\)" = "\$GITHUB_SHA"/);
  assert.match(workflow, /test ! -L "\$path"/);
  assert.match(workflow, /test ! -L "\$directory"/);
  assert.match(workflow, /release-manifest\.sha256/);
  assert.doesNotMatch(workflow, /cp -R|cp -r|rsync|cp --parents \*|upload-pages-artifact@main/);
});
