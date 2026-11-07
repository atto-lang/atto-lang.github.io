import test from 'node:test';
import assert from 'node:assert/strict';
import { STORAGE_KEY, MAX_PROGRAMS, MAX_SOURCE_BYTES, readPrograms, saveProgram, deleteProgram, parsePrograms } from '../src/saved-programs.js';
function memory() { const m = new Map(); return {getItem:k=>m.get(k)??null, setItem:(k,v)=>m.set(k,v)}; }
test('save/overwrite/restore/delete custom programs by name', () => {
  const m = memory();
  saveProgram(m, 'First', 'return 42;', 100);
  assert.equal(readPrograms(m)[0].source, 'return 42;');
  saveProgram(m, 'First', 'return 7;', 101);
  assert.equal(readPrograms(m).length, 1);
  saveProgram(m, 'Second', 'return 8;', 102);
  assert.deepEqual(readPrograms(m).map(p=>p.name), ['Second', 'First']);
  deleteProgram(m, 'First');
  assert.deepEqual(readPrograms(m).map(p=>p.name), ['Second']);
  assert.ok(m.getItem(STORAGE_KEY));
});
test('malformed local data is rejected without treating user strings as markup', () => {
  assert.deepEqual(parsePrograms('invalid'), []);
  assert.deepEqual(parsePrograms('{}'), []);
  const data = [{name:'<img onerror=evil>',source:'<script>text</script>'},
    {name:'hello',source:'code'},{name:'hello',source:'duplicated'},
    {name:'',source:'bad'},{name:'bad',source:'x'.repeat(MAX_SOURCE_BYTES+1)}];
  const good = parsePrograms(JSON.stringify(data));
  assert.deepEqual(good.map(p=>p.name), ['<img onerror=evil>', 'hello']);
  assert.equal(good[0].source, '<script>text</script>');
});
test('capacity, validation and storage errors fail without overwriting prior records', () => {
  const m = memory();
  for (const name of ['', ' ', 'x'.repeat(65), 'a\nb'])
    assert.throws(()=>saveProgram(m,name,'source'),/name/i);
  assert.throws(()=>saveProgram(m,'good','🚀'.repeat(20000)),/64 KiB/);
  assert.equal(m.getItem(STORAGE_KEY),null);
  for(let i=0;i<MAX_PROGRAMS;i++)saveProgram(m,'entry'+i,'return 1;');
  assert.throws(()=>saveProgram(m,'overflow','return 1;'),/maximum/);
  saveProgram(m,'entry0','updated');
  assert.equal(readPrograms(m)[0].source,'updated');
  assert.throws(()=>saveProgram({getItem:()=>null,setItem:()=>{throw Error('QuotaExceededError')}},'ok','x'),/QuotaExceededError/);
});
