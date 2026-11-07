import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { ASSETS, SITE_ASSETS, packagePlayground } from './package-playground.mjs';

async function enumerate(directory, prefix = '') {
  const list = [];
  for (const item of await readdir(directory, {withFileTypes:true})) {
    const name = prefix + item.name;
    if (item.isDirectory()) list.push(...await enumerate(join(directory,item.name),name+'/'));
    else list.push(name);
  }
  return list;
}

test('public release staging is an EXACT allowlist despite repository canary files', async t => {
  const root = await mkdtemp(join(tmpdir(),'atto-negative-publish-'));
  t.after(() => rm(root,{recursive:true,force:true}));
  for (const file of ASSETS) {
    const destination = join(root,'play',file);
    await mkdir(dirname(destination),{recursive:true});
    await writeFile(destination,await readFile(new URL('../../play/'+file,import.meta.url)));
  }
  for (const file of SITE_ASSETS) {
    const destination = join(root,file);
    await mkdir(dirname(destination),{recursive:true});
    await writeFile(destination,await readFile(new URL('../../'+file,import.meta.url)));
  }
  const canaries = [
    'play/tests/browser-e2e.mjs','play/tests/compiler.test.mjs',
    'play/package.json','play/src/unreviewed.js','play/.github/workflows/ci.yml',
    'play/.env','private.txt','.github/workflows/approved-playground-pages.yml'
  ];
  for (const canary of canaries) {
    const destination=join(root,canary);
    await mkdir(dirname(destination),{recursive:true});
    await writeFile(destination,'UNREVIEWED-PUBLIC-CANARY');
  }
  const result = await packagePlayground({root:join(root,'play'),outputRoot:root,sourceCommit:'a'.repeat(40)});
  const published = (await enumerate(join(root,'_site'))).sort();
  const approved = [...ASSETS.map(x=>'play/'+x),...SITE_ASSETS,'release-manifest.json'].sort();
  assert.deepEqual(published,approved);
  assert.deepEqual(Object.keys(result.assets).sort(),ASSETS.map(x=>'play/'+x).sort());
  assert.deepEqual(Object.keys(result.site_assets).sort(),[...SITE_ASSETS].sort());
  for (const name of canaries)
    assert.ok(!published.includes(name),'unreviewed file was published: '+name);
  const manifest=JSON.parse(await readFile(join(root,'_site/release-manifest.json'),'utf8'));
  assert.deepEqual(manifest,result);
});
test('explicit negative controls include live audit leaked paths', () => {
  for (const exposed of ['tests/browser-e2e.mjs','tests/compiler.test.mjs','package.json']) {
    assert.ok(!ASSETS.includes(exposed),'never publish '+exposed);
  }
  assert.ok(ASSETS.includes('public/atto_compiler.wasm'));
  assert.ok(ASSETS.includes('public/oreslang_format.wasm'));
});
