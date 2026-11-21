import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { ASSETS, PUBLICATION_ASSETS, packagePlayground, validateReleasePaths } from './package-playground.mjs';

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
  const renderedSiteRoot = join(root,'rendered-site');
  for (const file of PUBLICATION_ASSETS) {
    const destination = join(renderedSiteRoot,file);
    await mkdir(dirname(destination),{recursive:true});
    const bytes = file === 'deck/index.html' || file.endsWith('.js') || file.endsWith('.svg') || file.endsWith('.css') || file.endsWith('.png')
      ? await readFile(new URL('../../'+file,import.meta.url))
      : Buffer.from('<!doctype html><html lang="en"><head><title>Fixture</title></head><body>Reviewed '+file+'</body></html>');
    await writeFile(destination,bytes);
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
  const result = await packagePlayground({root:join(root,'play'),outputRoot:root,renderedSiteRoot,sourceCommit:'a'.repeat(40)});
  const published = (await enumerate(join(root,'_site'))).sort();
  const approved = [...ASSETS.map(x=>'play/'+x),...PUBLICATION_ASSETS,'release-manifest.json'].sort();
  assert.deepEqual(published,approved);
  assert.deepEqual(Object.keys(result.assets).sort(),[...ASSETS.map(x=>'play/'+x),...PUBLICATION_ASSETS].sort());
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


test('release allowlist paths fail closed before any filesystem read or deletion', () => {
  assert.doesNotThrow(() => validateReleasePaths(),
    'the currently reviewed play and publication allowlists must be safe');
  const malicious = [
    '../private.txt', '/etc/passwd', 'src/../tests/private.mjs',
    'src/./app.js', 'src//app.js', 'tests/secret.mjs',
    'tools/private.js', 'scripts/build.sh', 'node_modules/pkg/index.js',
    '.env', '.github/workflows/deploy.yml', 'src/.env',
    'package.json', 'BUILD_RECEIPT.md', 'src/package-lock.json',
    'src\\\\app.js', 'src/%2e%2e/secret', 'src/app.js?query=1',
    'src/tests/hidden.mjs', 'docs/tools/private.js', 'assets/node_modules/test.js',
  ];
  for (const name of malicious) {
    assert.throws(() => validateReleasePaths([...ASSETS, name], PUBLICATION_ASSETS),
      /Unsafe release asset path/, 'playground path accepted: ' + name);
    assert.throws(() => validateReleasePaths(ASSETS, [...PUBLICATION_ASSETS, name]),
      /Unsafe release asset path/, 'publication path accepted: ' + name);
  }
  assert.throws(() => validateReleasePaths([...ASSETS, ASSETS[0]], PUBLICATION_ASSETS),
    /Duplicate or malformed release allowlist/, 'duplicate playground path accepted');
  assert.throws(() => validateReleasePaths(ASSETS, [...PUBLICATION_ASSETS, PUBLICATION_ASSETS[0]]),
    /Duplicate or malformed release allowlist/, 'duplicate publication path accepted');
  assert.throws(() => validateReleasePaths(null, PUBLICATION_ASSETS),
    /Duplicate or malformed release allowlist/, 'invalid play allowlist shape accepted');
  assert.throws(() => validateReleasePaths(ASSETS, {}),
    /Duplicate or malformed release allowlist/, 'invalid publication allowlist shape accepted');
  for (const reserved of ['play', 'play/index.html', 'play/public/atto_compiler.wasm', 'release-manifest.json']) {
    assert.throws(() => validateReleasePaths(ASSETS, [...PUBLICATION_ASSETS, reserved]),
      /Unsafe release asset path/, 'publication collided with protected output: ' + reserved);
  }
});
