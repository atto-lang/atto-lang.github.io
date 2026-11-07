import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, mkdir, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { packagePlayground, ASSETS } from './package-playground.mjs';

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
  return {root:source, outputRoot:workspace};
}
test('publishes only reviewed assets with a digest manifest', async t => {
  const f = await fixture(t);
  await writeFile(join(f.root,'private-notes'),'secret');
  const r = await packagePlayground({...f,sourceCommit:'a'.repeat(40)});
  assert.equal(Object.keys(r.assets).length,ASSETS.length);
  const manifest = JSON.parse(await readFile(join(f.outputRoot,'_site/release-manifest.json'),'utf8'));
  assert.deepEqual(manifest,r);
  await assert.rejects(readFile(join(f.outputRoot,'_site/play/private-notes')),/ENOENT/);
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
