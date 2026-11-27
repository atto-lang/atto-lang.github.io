import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, mkdir, symlink, rm, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { packagePlayground, ASSETS, PUBLICATION_ASSETS, validateBrandSvg, validateBrandPng } from './package-playground.mjs';

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
    const bytes = ['deck/index.html','survey/index.html','comparisons/index.html'].includes(name) || name.endsWith('.js') || name.endsWith('.svg') || name.endsWith('.css') || name.endsWith('.png')
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
  assert.ok(!ASSETS.includes('BUILD_RECEIPT.md'),
    'build receipt is not a public release asset');
  assert.ok(!manifestAssetExists(r, 'BUILD_RECEIPT.md'));
  await assert.rejects(readFile(join(f.outputRoot,'_site/play/BUILD_RECEIPT.md')),/ENOENT/);

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
  await assert.rejects(packagePlayground(f), /Unsafe or malformed static publication HTML/);
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
  await writeFile(root,'<!doctype html><html><head></head><body><script src="https://invalid.example/script.js"></script><h1>Safe page</h1></body></html>');
  const scrubbed=await packagePlayground(f);
  const published=await readFile(join(f.outputRoot,'_site/index.html'),'utf8');
  assert.ok(Object.hasOwn(scrubbed.assets,'index.html'));
  assert.ok(!published.includes('<script') && published.includes('<h1>Safe page</h1>'));
  assert.ok(published.includes('/assets/site.css'), 'root must use allowlisted local stylesheet');
  await writeFile(root,'<!doctype html><script type="application/ld+json">not JSON</script>');
  await assert.rejects(packagePlayground(f), /Unexpected token|JSON/);
});

test('rejects active attributes and framed content in reviewed HTML', async t => {
  const f=await fixture(t);
  const root=join(f.renderedSiteRoot,'index.html');
  await writeFile(root,'<!doctype html><html><head></head><body><img src="x" onerror="alert(1)"></body></html>');
  await assert.rejects(packagePlayground(f), /Unsafe or malformed static publication HTML/);
  await writeFile(root,'<!doctype html><html><head></head><body><iframe src="https://example.test"></iframe></body></html>');
  await assert.rejects(packagePlayground(f), /Unsafe or malformed static publication HTML/);
});

test('rejects SVG event handler injection even without script elements', async t => {
  const f=await fixture(t);
  const image=join(f.renderedSiteRoot,'whitepapers/assets/01-semantic-layers.svg');
  await writeFile(image,'<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><title>X</title><desc>Y</desc></svg>');
  await assert.rejects(packagePlayground(f), /Unsafe publication SVG/);
});

test('marketing homepage publishes reviewed CSS without leaking root source', async t => {
  const f=await fixture(t);
  await writeFile(join(f.renderedSiteRoot,'index.html'), await readFile(new URL('../../index.html',import.meta.url)));
  await writeFile(join(f.outputRoot,'unreviewed-private.txt'),'not a public asset');
  const manifest=await packagePlayground(f);
  const html=await readFile(join(f.outputRoot,'_site/index.html'),'utf8');
  const css=await readFile(join(f.outputRoot,'_site/assets/site.css'),'utf8');
  assert.match(html,/href="\.\/play\/"/);
  assert.match(html,/href="\.\/whitepapers\/"/);
  assert.match(html,/href="\/assets\/site\.css"/);
  assert.match(html,/Content-Security-Policy/);
  assert.match(html,/experimental language/);
  assert.doesNotMatch(html,/<script\b|<iframe\b|<object\b/i);
  assert.match(css,/color-scheme/);
  assert.ok(Object.hasOwn(manifest.assets,'assets/site.css'));
  await assert.rejects(readFile(join(f.outputRoot,'_site/unreviewed-private.txt')),/ENOENT/);
});

test('marketing stylesheet denies symlinks and remote CSS imports', async t => {
  const f=await fixture(t);
  const css=join(f.renderedSiteRoot,'assets/site.css');
  await writeFile(css,"@import url('https://example.invalid/exfil.css');");
  await assert.rejects(packagePlayground(f),/External CSS dependency is forbidden/);
  await rm(css);
  await symlink('../index.html',css);
  await assert.rejects(packagePlayground(f),/Refusing publication symlink/);
});

test('architecture board is packaged with six explicit assets and no scripts/tests', async t => {
 const f=await fixture(t), r=await packagePlayground({...f,sourceCommit:'a'.repeat(40)});
 for(const x of ['index.html','styles.css','data.js','app.js','receipt.js','probe-worker.js']){
  assert.ok(ASSETS.includes('architecture/'+x));
  assert.ok(manifestAssetExists(r,'architecture/'+x));
 }
 assert.ok(ASSETS.every(x=>!x.startsWith('architecture/scripts/')&&!x.startsWith('architecture/tests/')));
 await assert.rejects(readFile(join(f.outputRoot,'_site/play/architecture/site-manifest.json')),/ENOENT/);
});
test('architecture publication refuses symlink injection',async t=>{
 const f=await fixture(t), file=join(f.root,'architecture/app.js');
 await rm(file);await symlink('data.js',file);
 await assert.rejects(packagePlayground(f),/Refusing symlink/);
});


test('brand SVGs remain minimal, square where required, and non-executable', async () => {
  for (const name of ['assets/atto-logo.svg','assets/atto-mark.svg']) {
    const source = await readFile(new URL('../../' + name, import.meta.url), 'utf8');
    assert.doesNotThrow(() => validateBrandSvg(source,name));
    for (const attack of [
      '<script>alert(1)</script>',
      '<image href="https://example.invalid/track.svg"/>',
      '<animate attributeName="opacity" from="1" to="0"/>',
      '<foreignObject><div>unsafe</div></foreignObject>',
      '<style>@import url(https://example.invalid/x.css)</style>',
      '<!DOCTYPE svg [<!ENTITY x "XX">]>'
    ]) {
      assert.throws(() => validateBrandSvg(source.replace('</svg>',attack+'</svg>'),name), /Unsafe Atto brand SVG/);
    }
    const externalFill = source.replace('fill="#0b1a34"', 'fill="url(https://example.invalid/x.svg)"');
    assert.throws(() => validateBrandSvg(externalFill,name), /Unsafe Atto brand SVG/);
  }
});

test('packaging refuses active content in the logo allowlist', async t => {
  const f = await fixture(t);
  const file = join(f.renderedSiteRoot, 'assets/atto-mark.svg');
  const source = await readFile(file,'utf8');
  await writeFile(file, source.replace('</svg>','<animate attributeName="opacity" to="0"/></svg>'));
  await assert.rejects(packagePlayground(f), /Unsafe Atto brand SVG/);
});

test('approved PNG derivatives reject unknown or modified bytes', async () => {
  for (const name of ['assets/favicon-32x32.png','assets/apple-touch-icon.png','assets/atto-social-preview.png']) {
    const source=await readFile(new URL('../../'+name,import.meta.url));
    assert.doesNotThrow(()=>validateBrandPng(source,name));
    assert.throws(()=>validateBrandPng(Buffer.concat([source,Buffer.from('injection')]),name),
      /Invalid or altered Atto brand PNG/);
    const altered=Buffer.from(source);altered[20]^=1;
    assert.throws(()=>validateBrandPng(altered,name),/Invalid or altered Atto brand PNG/);
  }
});
test('staged publication refuses a tampered social preview',async t=>{
  const f=await fixture(t);
  const file=join(f.renderedSiteRoot,'assets/atto-social-preview.png');
  const altered=await readFile(file);altered[altered.length-10]^=1;
  await writeFile(file,altered);
  await assert.rejects(packagePlayground(f),/Invalid or altered Atto brand PNG/);
});

test('deck publication preserves one trusted local script and rejects injected JS', async t => {
  const f = await fixture(t);
  const page = join(f.renderedSiteRoot, 'deck/index.html');
  const script = join(f.renderedSiteRoot, 'deck/deck.js');
  const originalPage = await readFile(page, 'utf8');
  const originalScript = await readFile(script, 'utf8');
  const manifest = await packagePlayground(f);
  assert.ok(Object.hasOwn(manifest.assets, 'deck/index.html'));
  assert.ok(Object.hasOwn(manifest.assets, 'deck/deck.css'));
  assert.ok(Object.hasOwn(manifest.assets, 'deck/deck.js'));
  const stagedPage = await readFile(join(f.outputRoot, '_site/deck/index.html'), 'utf8');
  assert.match(stagedPage, /<script src="\.\/deck\.js" defer><\/script>/);

  await writeFile(page, originalPage.replace(
    '<script src="./deck.js" defer></script>',
    '<script src="https://unreviewed.invalid/injected.js" defer></script>'));
  await assert.rejects(packagePlayground(f), /Missing or duplicate deck entry script/);

  await writeFile(page, originalPage + '<script>alert("unsafe")</script>');
  await assert.rejects(packagePlayground(f), /Unsafe or malformed static publication HTML/);
  await writeFile(page, originalPage);

  await writeFile(script, originalScript + '\nfetch("https://unreviewed.invalid");\n');
  await assert.rejects(packagePlayground(f), /Unsafe deck publication script/);
});

test('comparison route is packaged with exact static bytes and no unrelated source', async t => {
  const f = await fixture(t);
  await writeFile(join(f.renderedSiteRoot,'comparisons','private-notes.txt'),'not approved');
  const manifest = await packagePlayground(f);
  for (const name of ['comparisons/index.html','comparisons/comparisons.css']) {
    assert.ok(Object.hasOwn(manifest.assets,name));
    assert.deepEqual(await readFile(join(f.outputRoot,'_site',name)),await readFile(join(f.renderedSiteRoot,name)));
  }
  await assert.rejects(readFile(join(f.outputRoot,'_site/comparisons/private-notes.txt')), /ENOENT/);
});
