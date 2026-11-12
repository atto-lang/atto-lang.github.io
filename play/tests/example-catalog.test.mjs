import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { EXAMPLES, exampleById } from '../src/example-catalog.js';

test('catalog identifiers and .atto files have exact one-to-one mapping', async () => {
  const ids=EXAMPLES.map(x=>x.id);
  assert.equal(new Set(ids).size,ids.length);
  assert.equal(ids.length,18);
  for (const item of EXAMPLES) {
    assert.match(item.id,/^[a-z][a-z0-9-]*$/);
    assert.ok(item.label.length>=3);
    assert.equal(exampleById(item.id),item);
    const contents=await readFile(new URL('../examples/'+item.id+'.atto',import.meta.url),'utf8');
    assert.ok(contents.length>35);
    if(item.runnable) assert.doesNotMatch(contents,/^\/\/ LANGUAGE PREVIEW —/);
    else assert.match(contents,/^\/\/ LANGUAGE PREVIEW —/);
  }
  assert.equal(exampleById('../index.html'),null);
  const files=(await readdir(new URL('../examples/',import.meta.url))).filter(x=>x.endsWith('.atto')).sort();
  assert.deepEqual(files,ids.map(id=>id+'.atto').sort());
});

test('conditions example does not teach comma or pipe as logical operators',async()=>{
  const conditions=await readFile(new URL('../examples/conditions.atto',import.meta.url),'utf8');
  assert.match(conditions,/&& is AND, \|\| is OR, \^\^ is XOR/);
  assert.match(conditions,/if And\(/);
  assert.match(conditions,/if Or\(/);
  assert.doesNotMatch(conditions,/^\s*if a > 0, b > 0 then/m);
  assert.doesNotMatch(conditions,/^\s*if even\(a\) \| even\(b\) then/m);
});
