import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

// Defense in depth while legacy GitHub Pages is still configured. This test
// cannot certify the actual Pages setting or replace the live HTTPS audit.
test('legacy Pages exclusion list blocks known non-release playground paths', async () => {
  const body = await readFile(new URL('../../_config.yml', import.meta.url), 'utf8');
  assert.match(body, /^exclude:\s*$/m);
  const entries = body.split('\n').flatMap(line => {
    const match = /^\s*-\s+([^#\s]+)\s*$/.exec(line);
    return match ? [match[1]] : [];
  });
  for (const required of [
    'README.md', 'play/tests', 'play/package.json',
    'play/package-lock.json', 'play/scripts', 'play/BUILD_RECEIPT.md',
    'play/node', 'play/tools', 'play/release-candidates', 'play/architecture/scripts', 'play/architecture/tests', 'play/architecture/site-manifest.json', 'play/architecture/README.md', 'scripts', 'verification'
  ]) assert.ok(entries.includes(required), 'missing legacy exclusion: ' + required);
  for (const needed of [
    'play/index.html', 'play/src', 'play/public', 'play/styles.css', 'play/examples',
    'index.html', 'assets'
  ]) assert.ok(!entries.includes(needed), 'legacy exclusion would break site: ' + needed);
  assert.ok(body.includes('Settings > Pages > Source: GitHub Actions'));
});


test('legacy Pages exemptions preserve runtime but not compiler candidates or Node-only code',async()=>{
 const body=await readFile(new URL('../../_config.yml',import.meta.url),'utf8');
 const excluded=body.split('\n').flatMap(line=>(/^\s*-\s+([^#\s]+)\s*$/.exec(line)||[]).slice(1));
 assert.equal(new Set(excluded).size,excluded.length,'Duplicate exclusions hide policy drift');
 for(const sensitive of ['play/node','play/tools','play/release-candidates','play/tests','play/architecture/scripts','play/architecture/tests','play/architecture/site-manifest.json','play/architecture/README.md']){
  assert.ok(excluded.includes(sensitive),'Sensitive tree not excluded: '+sensitive);
 }
 for(const required of ['play/src','play/public','play/examples','play/architecture','play/index.html']){
  assert.ok(!excluded.includes(required),'Would break production runtime: '+required);
 }
 assert.match(body,/DEFENSE IN DEPTH FOR LEGACY JEKYLL PAGES MODE ONLY/);
});
