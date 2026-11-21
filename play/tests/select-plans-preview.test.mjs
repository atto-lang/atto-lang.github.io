// These are source/release-contract tests, NOT compiled Atto guest evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = name => readFile(new URL('../'+name, import.meta.url), 'utf8');
const examples = {
  'static-select-plans': [
    'select {',
    'on readch(control) as value',
    'SelectPlan.from_list([',
    'SelectPlan.from_map(record{',
    'SelectCase.read(control)',
    'try select fair from plan',
    'nb select first from plan',
    'await pending',
    'INVALID: plan.put(0'
  ],
  'dynamic-select-plans': [
    'DynamicSelectPlan<int>',
    'DynamicSelectPlan<string>',
    'DynamicSelectPlan.from_list([',
    'DynamicSelectPlan.from_map(record{',
    'plan.remove(0)',
    'plan.put(0,',
    'plan.remove("control")',
    'plan.put("control",',
    'try select first from plan',
    'nb select first from plan',
    'plan generation',
    'INVALID: cancel/STOP'
  ]
};

test('static and dynamic select plans are syntax-only, uniquely registered and release-allowlisted', async () => {
  const [html, app, profile, release, catalog] = await Promise.all([
    read('index.html'), read('src/app.js'), read('example-backend-profile.json').then(JSON.parse),
    read('../.github/scripts/package-playground.mjs'), read('tests/example-catalog.test.mjs')
  ]);
  const previews = JSON.parse(app.match(/const PREVIEW_EXAMPLES = new Set\((\[[^\n]+\])\)/)[1]);
  const executable = JSON.parse(app.match(/const EXECUTABLE_PREVIEWS = new Set\((\[[^\n]+\])\)/)[1]);
  for (const [slug, required] of Object.entries(examples)) {
    const id = 'preview/' + slug;
    const source = await read('examples/preview/' + slug + '.atto');
    assert.match(source, /^\/\/ SYNTAX PREVIEW — NOT browser-lowered/);
    assert.match(source, /pub fnc main\(\): int \{/);
    assert.equal(html.split('value="'+id+'"').length - 1, 1);
    assert.equal(previews.filter(x=>x===id).length, 1);
    assert.equal(executable.includes(id), false);
    assert.deepEqual(profile.preview.filter(x=>x.name===slug), [{name:slug,expect:'preview-only'}]);
    assert.equal(release.split("'examples/preview/" + slug + ".atto'").length - 1, 1);
    assert.ok(catalog.includes('"'+slug+'"'));
    for (const token of required) assert.ok(source.includes(token), slug+': missing '+token);
  }
});

test('select plan examples retain distinct lifetimes, fair rules and generation safety', async () => {
  const [staticSource, dynamicSource] = await Promise.all([
    read('examples/preview/static-select-plans.atto'),
    read('examples/preview/dynamic-select-plans.atto')
  ]);
  assert.match(staticSource, /immutable SelectPlan snapshots/);
  assert.match(staticSource, /fresh one-shot registrations/);
  assert.match(staticSource, /default\/try-miss\/cancel advances the FAIR cursor/);
  assert.doesNotMatch(staticSource, /^\s*plan\.put\(/m, 'immutable SelectPlan must not mutate');
  assert.match(dynamicSource, /pending selection captures a plan generation/);
  assert.match(dynamicSource, /plan stays alive until the pending await settles/);
  assert.match(dynamicSource, /winner = await pending;/);
  assert.match(dynamicSource, /INVALID: altering a pending select's captured generation/);
  assert.match(dynamicSource, /ordinal, not a map key/);
  assert.doesNotMatch(dynamicSource, /PlannedResult<string>\s+winner/, 'unverified keyed result must not be advertised');
});
