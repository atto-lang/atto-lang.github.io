import test from 'node:test';
import assert from 'node:assert/strict';
import { STORAGE_KEY, MAX_PROGRAMS, MAX_SOURCE_BYTES, readPrograms, saveProgram, deleteProgram, parsePrograms, exportPrograms, decodeBackup, importPrograms, BACKUP_FORMAT, MAX_BACKUP_BYTES } from '../src/saved-programs.js';
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

test('portable JSON backup roundtrip and atomic merge across devices', () => {
  const a = memory(), b = memory();
  saveProgram(a,'🚀 Demo','fnc main() -> int { return 42; }',1);
  saveProgram(a,'Second','<img onerror="evil">',2);
  const json = exportPrograms(a);
  assert.equal(JSON.parse(json).format, BACKUP_FORMAT);
  assert.deepEqual(decodeBackup(json).map(p=>p.name), ['Second','🚀 Demo']);
  const result = importPrograms(b,json);
  assert.equal(result.imported,2);
  assert.deepEqual(readPrograms(b),readPrograms(a));
  assert.equal(importPrograms(b,json,{onConflict:'keep'}).imported,0);
  assert.throws(()=>importPrograms(b,json),/Import conflict/);
  saveProgram(a,'Second','updated',3);
  assert.equal(importPrograms(b,exportPrograms(a),{onConflict:'replace'}).imported,2);
  assert.equal(readPrograms(b)[0].source,'updated');
});
test('backup corruption and collisions fail closed without changing existing data', () => {
  const m=memory();
  saveProgram(m,'safe','42',7);
  const before=m.getItem(STORAGE_KEY);
  const backup=JSON.parse(exportPrograms(m));
  for (const invalid of [
    '{!', '{}', JSON.stringify({...backup,format:'unknown'}),
    JSON.stringify({...backup, programs:[backup.programs[0],backup.programs[0]]}),
    JSON.stringify({...backup, programs:[{name:'x',source:'abc',updatedAt:-1}]}),
    JSON.stringify({...backup, programs:[{name:'a\nb',source:'a',updatedAt:1}]}),
    ' '.repeat(MAX_BACKUP_BYTES+1)
  ]) {
    assert.throws(()=>importPrograms(m,invalid));
    assert.equal(m.getItem(STORAGE_KEY),before);
  }
  assert.throws(()=>importPrograms(m, exportPrograms(m), {onConflict:'unknown'}));
  assert.equal(m.getItem(STORAGE_KEY),before);
});
test('quota errors and corrupted localStorage never erase current records', () => {
  const m=memory();
  saveProgram(m,'a','hello',10);
  const json=exportPrograms(m);
  m.setItem(STORAGE_KEY,'{oops');
  assert.throws(()=>saveProgram(m,'b','new'),/malformed/);
  assert.throws(()=>deleteProgram(m,'a'),/malformed/);
  assert.throws(()=>exportPrograms(m),/malformed/);
  assert.throws(()=>importPrograms(m,json),/malformed/);
  assert.equal(m.getItem(STORAGE_KEY),'{oops');
  const quota={getItem:()=>null,setItem:()=>{throw Error('QuotaExceededError')}};
  assert.throws(()=>importPrograms(quota,json),/QuotaExceededError/);
});
