import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const read = p => readFileSync(new URL('../../'+p,import.meta.url));
const m=JSON.parse(read('comparisons/parity-candidates.json'));
const html=read('comparisons/index.html').toString();
const profile=JSON.parse(read('play/example-backend-profile.json'));
const receipt=JSON.parse(read('play/public/atto_compiler.receipt.json'));
const blob=b=>createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex');
const names=['atto','cranelift','forge','hdl','java','js','llvm','net','realtime','rs','wasm'];
const sha=/^[0-9a-f]{40}$/;
function verify(x){
  assert.equal(x.schema,'atto.comparator.parity-candidates.v1');
  assert.equal(x.source.repository,'atto-lang/atto-lang.github.io');
  assert.match(x.source.commit,sha);assert.match(x.source.tree,sha);
  assert.equal(x.source.profile_blob,blob(read('play/example-backend-profile.json')));
  assert.deepEqual(x.browser_compiler,{source_head:receipt.source_head,source_tree:receipt.source_tree,compiler_sha256:receipt.compiler_sha256,target:receipt.target});
  assert.deepEqual(x.backends.map(b=>b.id).sort(),names);
  for(const b of x.backends){assert.equal(b.repository,'atto-lang/atto-source.'+b.id);assert.match(b.commit,sha);assert.match(b.tree,sha);assert.equal(b.observation,'NOT_VERIFIED_FOR_CORPUS');assert.ok(b.profile&&b.requirement);}
  const expected=profile.preview.filter(p=>p.expect==='exec');
  assert.deepEqual(x.cases.map(c=>c.name),expected.map(p=>p.name));
  for(const [i,c] of x.cases.entries()){assert.equal(c.path,'play/examples/preview/'+c.name+'.atto');assert.equal(c.blob,blob(read(c.path)));assert.equal(c.return,expected[i].return);assert.equal(c.stdout,expected[i].stdout);}
}
test('parity corpus pins exact positive source blobs and all eleven backend identities without certifying execution',()=>verify(m));
test('reject missing/duplicate backends, changed source, wrong stdout and fabricated parity',()=>{
  const mutate=[x=>x.backends.pop(),x=>x.backends[0].id=x.backends[1].id,x=>x.backends[0].observation='PASS',x=>x.cases[0].blob='0'.repeat(40),x=>x.cases[0].stdout+=' ',x=>x.cases[0].return='42',x=>x.cases.pop(),x=>x.browser_compiler.source_head='0'.repeat(40),x=>x.source.profile_blob='0'.repeat(40)];
  for(const fn of mutate){const x=structuredClone(m);fn(x);assert.throws(()=>verify(x));}
});
test('rendered matrix has all profiles and exact candidate links, never reports a backend pass',()=>{
  const rows=[...html.matchAll(/<tr data-backend="([^"]+)">([\s\S]*?)<\/tr>/g)];
  assert.deepEqual(rows.map(r=>r[1]).sort(),names);
  for(const [,id,row] of rows){const b=m.backends.find(x=>x.id===id);assert.ok(row.includes('/tree/'+b.commit));assert.ok(row.includes('data-parity="NOT_VERIFIED_FOR_CORPUS"'));}
  const fixtures=[...html.matchAll(/<tr data-fixture="([^"]+)">([\s\S]*?)<\/tr>/g)];
  assert.deepEqual(fixtures.map(r=>r[1]),m.cases.map(c=>c.name));
  for(const [,id,row] of fixtures){const c=m.cases.find(x=>x.name===id);assert.ok(row.includes('/blob/'+m.source.commit+'/'+c.path));assert.ok(row.includes(c.blob.slice(0,12)));assert.ok(row.includes('preview/'+id+'&amp;run=1'));}
});
