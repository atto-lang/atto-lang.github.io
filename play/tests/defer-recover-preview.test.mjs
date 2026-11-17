import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const source = read('../examples/preview/defer-recover.atto');

test('defer/recover preview describes distinct ordinary, escalated and fatal effects', () => {
  assert.match(source, /^\/\/ LANGUAGE PREVIEW — compiles and runs in this browser playground\./);
  assert.doesNotMatch(source, /not yet\s*\n?\/\/ executable in the pinned browser compiler/);
  assert.match(source, /fnc raise_failure\(\): int raises\(Error\)/);
  assert.match(source, /raise new Error\("escalated failure"\);/);
  assert.match(source, /fnc inner_throw\(\): int throws\(Error\)/);
  assert.match(source, /throw new Error\("ordinary throw"\);/);
  for (const name of ['recover_raise', 'recover_escaped_throw', 'catch_before_recover'])
    assert.match(source, new RegExp('fnc ' + name + '\\(\\): int'));
  assert.match(source, /defer \|\| -> \{/);
  assert.match(source, /recover \(\|string context\| -> \|err, c\| -> \{/);
  assert.match(source, /c\.next\(\)/);
  assert.match(source, /fnc callee_with_recover\(\): int throws\(Error\)/);
  assert.match(source, /fnc catch_in_outer_caller\(\): int/);
  assert.match(source, /UNEXPECTED callee recover/);
  assert.match(source, /return callee_with_recover\(\);/);
  assert.match(source, /the callee's recovery handler must not execute/);
  assert.match(source, /catch \(Error e\)/);
  assert.match(source, /\} finally \{/);
  assert.match(source, /panic\/cancellation always bypass/);
  assert.match(source, /return recover_raise\(\) \+ recover_escaped_throw\(\)/);
  assert.match(source, /\+ catch_before_recover\(\) \+ catch_in_outer_caller\(\); \/\/ 63/);
});

test('defer/recover preview is listed as runnable and stays in the reviewed release', () => {
  const html = read('../index.html');
  const app = read('../src/app.js');
  const packageScript = read('../../.github/scripts/package-playground.mjs');
  const match = html.match(/<option value="preview\/defer-recover">([^<]+)<\/option>/);
  assert.ok(match && /defer.*recover.*raise/.test(match[1]));
  const runs = html.match(/<optgroup label="Language previews — run in the browser">([\s\S]*?)<\/optgroup>/);
  assert.ok(runs && runs[1].includes('value="preview/defer-recover"'), 'defer-recover is in the run-in-the-browser group');
  assert.match(app, /const EXECUTABLE_PREVIEWS = new Set\([^\n]*"preview\/defer-recover"/);
  assert.match(app, /"preview\/defer-recover"/);
  assert.match(app, /const PREVIEW_EXAMPLES = new Set/);
  assert.ok(packageScript.includes("'examples/preview/defer-recover.atto'"));
  const runnable = html.match(/<optgroup label="Examples">([\s\S]*?)<\/optgroup>/)?.[1];
  assert.ok(runnable);
  assert.doesNotMatch(runnable, /preview\/defer-recover/);
});
