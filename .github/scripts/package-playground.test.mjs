import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, mkdir, symlink, rm, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { packagePlayground, ASSETS, PUBLICATION_ASSETS } from './package-playground.mjs';

async function fixture(t) {
  const workspace = await mkdtemp(join(tmpdir(),'atto-public-package-'));
  t.after(() => rm(workspace,{recursive:true,force:true}));
  const source = join(workspace,'play');
  for (const name of ASSETS) {
    const file = join(source,name);
    await mkdir(dirname(file),{recursive:true});
    const bytes = await readFile(new URL('../../play/'+name, import.meta.url));
    await writeFile(file,bytes);
  }
  const renderedSiteRoot = join(workspace, 'rendered-whitepapers');
  for (const name of PUBLICATION_ASSETS) {
    const file = join(renderedSiteRoot, name);
    await mkdir(dirname(file), {recursive:true});
    const bytes = name.endsWith('.svg') || name.endsWith('.css')
      ? await readFile(new URL('../../' + name, import.meta.url))
      : Buffer.from('<!doctype html><html lang="en"><head><title>Documentation fixture</title></head><body>Reviewed ' + name + '</body></html>');
    await writeFile(file, bytes);
  }
  return {root:source, outputRoot:workspace, renderedSiteRoot};
}
const manifestAssetExists = (manifest, name) => Object.hasOwn(manifest.assets, 'play/' + name);

test('publishes only reviewed assets with a digest manifest', async t => {
  const f = await fixture(t);
  await writeFile(join(f.root,'private-notes'),'secret');
  await writeFile(join(f.renderedSiteRoot, 'whitepapers', 'unreviewed.html'), '<!doctype html>secret');
  const r = await packagePlayground({...f,sourceCommit:'a'.repeat(40)});
  assert.equal(Object.keys(r.assets).length,ASSETS.length + PUBLICATION_ASSETS.length);
  assert.ok(ASSETS.includes('src/editor.js'), 'native editor is a required public release asset');
  assert.ok(ASSETS.includes('src/ui.js'), 'diagnostic and Wasm UI helpers must ship');
  assert.ok(manifestAssetExists(r, 'src/editor.js'));
  assert.ok(manifestAssetExists(r, 'src/ui.js'));

  const manifest = JSON.parse(await readFile(join(f.outputRoot,'_site/release-manifest.json'),'utf8'));
  assert.deepEqual(manifest,r);
  await assert.rejects(readFile(join(f.outputRoot,'_site/play/private-notes')),/ENOENT/);
  assert.ok(Object.hasOwn(r.assets, 'whitepapers/11-async-programming-and-structured-concurrency.html'));
  assert.ok(Object.hasOwn(r.assets, 'whitepapers/assets/11-structured-concurrency.svg'));
  assert.ok(Object.hasOwn(r.assets, 'index.html'));
  await assert.rejects(readFile(join(f.outputRoot,'_site/whitepapers/unreviewed.html')),/ENOENT/);
});
test('rejects compiler mismatches and unapproved digest', async t => {
  const f = await fixture(t);
  await assert.rejects(packagePlayground({...f,approvedSha256:'f'.repeat(64)}),/not been approved/);
  const file = join(f.root,'public/atto_compiler.wasm');
  const bytes = await readFile(file);
  bytes[bytes.length-1] ^= 1;
  await writeFile(file,bytes);
  await assert.rejects(packagePlayground(f),/binary\/receipt\/pin verification failed/);
});
test('rejects symlinks and never follows a destination symlink', async t => {
  const f = await fixture(t);
  const from = join(f.root,'src/app.js');
  await rm(from);
  await symlink('worker-task.js',from);
  await assert.rejects(packagePlayground(f),/Refusing symlink/);
  const clean = await fixture(t);
  await symlink('play',join(clean.outputRoot,'_site'));
  await assert.rejects(packagePlayground(clean),/destination must not be a symlink/);
});

test('rejects tampered canonical Rust formatter or forged receipt', async t => {
  const f=await fixture(t);
  const receipt=join(f.root,'public/oreslang_format.receipt.json');
  const r=JSON.parse(await readFile(receipt,'utf8'));
  r.wasm_sha256='0'.repeat(64);
  await writeFile(receipt,JSON.stringify(r));
  await assert.rejects(packagePlayground(f),/Formatter binary\/receipt\/pin verification failed/);
  await writeFile(receipt,await readFile(new URL('../../play/public/oreslang_format.receipt.json',import.meta.url)));
  const wasm=join(f.root,'public/oreslang_format.wasm');
  await writeFile(wasm,'not Wasm');
  await assert.rejects(packagePlayground(f),/Formatter binary\/receipt\/pin verification failed/);
});

test('fails closed if rendered documentation is omitted or malformed', async t => {
  const f = await fixture(t);
  await assert.rejects(
    packagePlayground({...f, renderedSiteRoot:null}),
    /Reviewed Jekyll publication build is required/
  );
  const bad = join(f.renderedSiteRoot, 'whitepapers/01-language-design.html');
  await writeFile(bad, '<!doctype html><script>alert(1)</script>');
  await assert.rejects(packagePlayground(f), /Unexpected active or malformed publication HTML/);
});

test('rejects symlinks and unexpected active SVG markup in rendered publication', async t => {
  const f = await fixture(t);
  const file = join(f.renderedSiteRoot, 'whitepapers/assets/01-semantic-layers.svg');
  await rm(file);
  await symlink('02-compiler-pipeline.svg', file);
  await assert.rejects(packagePlayground(f), /Refusing publication symlink/);
  await rm(file);
  await writeFile(file,'<svg><title>X</title><desc>Y</desc><script>alert(1)</script></svg>');
  await assert.rejects(packagePlayground(f), /Unsafe publication SVG/);
});

test('rejects symlinks at rendered publication root', async t => {
  const f = await fixture(t);
  const target = f.renderedSiteRoot + '-real';
  await rename(f.renderedSiteRoot, target);
  await symlink(target, f.renderedSiteRoot);
  await assert.rejects(packagePlayground(f), /Rendered publication root must be a real directory/);
});

test('accepts only valid non-executable JSON-LD in the root Jekyll page', async t => {
  const f=await fixture(t);
  const root=join(f.renderedSiteRoot,'index.html');
  await writeFile(root,'<!doctype html><html><head><script type="application/ld+json">{"@context":"https://schema.org","@type":"WebSite"}</script></head><body>Site</body></html>');
  const manifest=await packagePlayground(f);
  assert.ok(Object.hasOwn(manifest.assets,'index.html'));
  await writeFile(root,'<!doctype html><html><body><script src="https://invalid.example/script.js"></script><h1>Safe page</h1></body></html>');
  const scrubbed=await packagePlayground(f);
  const published=await readFile(join(f.outputRoot,'_site/index.html'),'utf8');
  assert.ok(Object.hasOwn(scrubbed.assets,'index.html'));
  assert.ok(!published.includes('<script') && published.includes('<h1>Safe page</h1>'));
  await writeFile(root,'<!doctype html><script type="application/ld+json">not JSON</script>');
  await assert.rejects(packagePlayground(f), /Unexpected token|JSON/);
});

test('rejects active attributes and framed content in reviewed HTML', async t => {
  const f=await fixture(t);
  const root=join(f.renderedSiteRoot,'index.html');
  await writeFile(root,'<!doctype html><html><body><img src="x" onerror="alert(1)"></body></html>');
  await assert.rejects(packagePlayground(f), /Unsafe or malformed static publication HTML/);
  await writeFile(root,'<!doctype html><html><body><iframe src="https://example.test"></iframe></body></html>');
  await assert.rejects(packagePlayground(f), /Unsafe or malformed static publication HTML/);
});
