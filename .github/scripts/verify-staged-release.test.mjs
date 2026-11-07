import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, unlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { ASSETS, SITE_ASSETS, packagePlayground } from './package-playground.mjs';
import { verifyStagedRelease } from './verify-staged-release.mjs';

const SOURCE = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);
const WRONG = 'f'.repeat(64);
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(),'atto-stage-verify-'));
  t.after(() => rm(root,{recursive:true,force:true}));
  for (const p of ASSETS) {
    const target = join(root,'play',p);
    await mkdir(dirname(target),{recursive:true});
    await writeFile(target,await readFile(new URL('../../play/'+p,import.meta.url)));
  }
  for (const p of SITE_ASSETS) {
    const target = join(root,p);
    await mkdir(dirname(target),{recursive:true});
    await writeFile(target,await readFile(new URL('../../'+p,import.meta.url)));
  }
  await packagePlayground({root:join(root,'play'),outputRoot:root,sourceCommit:SOURCE});
  return root;
}
test('exact staged release tree, manifest, source and Wasm hash pass',async t=>{
  const root=await fixture(t);
  const result=await verifyStagedRelease({outputRoot:root,expectedSourceCommit:SOURCE});
  assert.equal(result.source_commit,SOURCE);
  assert.match(result.compiler_sha256,/^[a-f0-9]{64}$/);
  assert.equal(result.asset_count,ASSETS.length+SITE_ASSETS.length);
});
test('source commit is mandatory and cannot drift',async t=>{
  const root=await fixture(t);
  await assert.rejects(verifyStagedRelease({outputRoot:root}),/Exact source/);
  await assert.rejects(verifyStagedRelease({outputRoot:root,expectedSourceCommit:OTHER}),/source or compiler/);
  await assert.rejects(verifyStagedRelease({outputRoot:root,expectedSourceCommit:'main'}),/Exact source/);
});
test('independent compiler approval must match staged Wasm',async t=>{
  const root=await fixture(t);
  await assert.rejects(verifyStagedRelease({outputRoot:root,expectedSourceCommit:SOURCE,expectedCompilerSha256:WRONG}),/independent approval/);
  await assert.rejects(verifyStagedRelease({outputRoot:root,expectedSourceCommit:SOURCE,expectedCompilerSha256:'FAKE'}),/Malformed approved/);
});
test('unexpected source, test or secret file in published tree is rejected',async t=>{
  const root=await fixture(t);
  const name=join(root,'_site/play/package.json');
  await writeFile(name,'unreviewed');
  await assert.rejects(verifyStagedRelease({outputRoot:root,expectedSourceCommit:SOURCE}),/staged paths/);
});
test('symlink injected after packaging is rejected regardless of target',async t=>{
  const root=await fixture(t);
  const link=join(root,'_site/play/payload.txt');
  await symlink(join(root,'play/index.html'),link);
  await assert.rejects(verifyStagedRelease({outputRoot:root,expectedSourceCommit:SOURCE}),/Symlink/);
});
test('changed existing asset bytes after staging are rejected',async t=>{
  const root=await fixture(t);
  await writeFile(join(root,'_site/play/index.html'),'malicious replacement');
  await assert.rejects(verifyStagedRelease({outputRoot:root,expectedSourceCommit:SOURCE}),/asset metadata|digest/);
});
test('manifest tampering and unlisted metadata are rejected',async t=>{
  const root=await fixture(t);
  const path=join(root,'_site/release-manifest.json');
  const data=JSON.parse(await readFile(path,'utf8'));
  data.extra='unreviewed';
  await writeFile(path,JSON.stringify(data));
  await assert.rejects(verifyStagedRelease({outputRoot:root,expectedSourceCommit:SOURCE}),/manifest structure/);
});
test('missing allowlisted source asset is rejected',async t=>{
  const root=await fixture(t);
  await unlink(join(root,'_site/play/src/app.js'));
  await assert.rejects(verifyStagedRelease({outputRoot:root,expectedSourceCommit:SOURCE}),/staged paths/);
});
test('forged hash and invalid compiler digest are rejected',async t=>{
  const root=await fixture(t);
  const path=join(root,'_site/release-manifest.json');
  const data=JSON.parse(await readFile(path,'utf8'));
  data.assets['play/src/app.js'].sha256=WRONG;
  await writeFile(path,JSON.stringify(data));
  await assert.rejects(verifyStagedRelease({outputRoot:root,expectedSourceCommit:SOURCE}),/digest mismatch/);
});
test('manifest symlink cannot substitute a trusted receipt',async t=>{
  const root=await fixture(t);
  const m=join(root,'_site/release-manifest.json');
  await unlink(m);
  await symlink(join(root,'play/index.html'),m);
  await assert.rejects(verifyStagedRelease({outputRoot:root,expectedSourceCommit:SOURCE}),/Symlink/);
});
