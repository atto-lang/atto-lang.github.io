// Public /play/ lifecycle examples: source preview and pinned-compiler gate.
// These tests must never upgrade unimplemented actor features to guest PASS.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createCompiler} from '../src/compiler.js';

const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');
const names = ['actor-lifecycle-ready','actor-pipe-without-ready'];

test('new lifecycle previews are registered exactly once and remain diagnostic-only', async () => {
  const [html, app, release, catalog, profileJson] = await Promise.all([
    read('index.html'), read('src/app.js'),
    read('../.github/scripts/package-playground.mjs'),
    read('tests/example-catalog.test.mjs'), read('example-backend-profile.json')
  ]);
  const profile=JSON.parse(profileJson);
  const available=JSON.parse(app.match(/const PREVIEW_EXAMPLES = new Set\((\[[^\n]+\])\)/)[1]);
  const executable=JSON.parse(app.match(/const EXECUTABLE_PREVIEWS = new Set\((\[[^\n]+\])\)/)[1]);
  for (const name of names) {
    const id='preview/'+name;
    assert.equal(html.split('value="'+id+'"').length-1,1,name+': picker count');
    assert.equal(available.filter(x=>x===id).length,1,name+': registered count');
    assert.ok(!executable.includes(id),name+': must NOT be displayed as runnable');
    assert.deepEqual(profile.preview.filter(x=>x.name===name),[{name,expect:'preview-only'}]);
    assert.equal(release.split("'examples/preview/"+name+".atto'").length-1,1);
    assert.ok(catalog.includes('"'+name+'"'),name+': not in canonical catalog');
  }
  const oldPipe=await read('examples/preview/pipe-rpipe.atto');
  const bang=await read('examples/preview/actor-pipeline-bang-aliases.atto');
  for(const src of [oldPipe,bang]) {
    assert.match(src,/ALTERNATIVE/);
    assert.match(src,/get_done\(\)/);
    assert.doesNotMatch(src,/^\s*consumer rpipe!? producer;/m,
      'two separate executable connections falsely imply duplex');
  }
});

test('examples distinguish READY, DONE, optional await and readiness-independent admission', async () => {
  const [life,pipe]=await Promise.all(names.map(n=>read('examples/preview/'+n+'.atto')));
  for(const src of [life,pipe]) {
    assert.match(src,/^\/\/ SYNTAX PREVIEW — NOT browser-lowered/);
    assert.match(src,/pub susp fnc main\(\)/);
    assert.match(src,/stop! /);
    assert.match(src,/get_done\(\)/);
    assert.match(src,/INVALID:/);
    assert.doesNotMatch(src,/^\s*await Future\.all\(/m);
  }
  assert.match(life,/await worker\.get_ready\(\)/);
  assert.match(life,/await spawn Worker\(\)/);
  assert.match(life,/INVALID: await worker\.ready/);
  assert.match(life,/INVALID: await worker\.done/);
  assert.match(pipe,/val link = \(producer pipe! consumer\)\?/);
  assert.match(pipe,/consumer rpipe! producer/);
  assert.doesNotMatch(pipe,/^\s*await (?:producer|consumer)\.get_ready\(/m,
    'pipeline should connect without requiring readiness wait');
  assert.match(pipe,/await link\.get_done\(\)/);
  assert.match(pipe,/await producer\.get_done\(\)/);
  assert.match(pipe,/await consumer\.get_done\(\)/);
});

test('the pinned public compiler refuses unimplemented actor lifecycle sources without guests', async () => {
  const [wasm, receipt]=await Promise.all([
    readFile(new URL('../public/atto_compiler.wasm', import.meta.url)),
    read('public/atto_compiler.receipt.json').then(JSON.parse)
  ]);
  assert.equal(wasm.length, receipt.compiler_bytes);
  assert.equal(createHash('sha256').update(wasm).digest('hex'),receipt.compiler_sha256);
  const compiler=await createCompiler(wasm);
  for (const name of [...names,'actor-pipeline-bang-aliases','pipe-rpipe']) {
    const source=await read('examples/preview/'+name+'.atto');
    const result=compiler.compile(source);
    assert.equal(result.ok,false,name+': unsupported source compiled');
    assert.equal(Object.hasOwn(result,'wasm'),false,name+': emitted a guest');
    assert.match(result.diagnostics?.[0]?.message??'',/^E_[A-Z0-9_]+:/);
    assert.ok(result.diagnostics?.[0]?.line>=1);
    assert.ok(result.diagnostics?.[0]?.column>=1);
    const good=compiler.compile('pub fnc main(): int { return 42; }');
    assert.equal(good.ok,true,name+': failed recovery');
    assert.ok(WebAssembly.validate(good.wasm));
  }
});
