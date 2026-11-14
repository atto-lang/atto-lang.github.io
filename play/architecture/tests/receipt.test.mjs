import test from 'node:test';
import assert from 'node:assert/strict';
import {validateReceipt} from '../receipt.js';
import {readFileSync} from 'node:fs';
const base=JSON.parse(readFileSync(new URL('../examples/receipt.example.json',import.meta.url),'utf8'));
function good(){return {...base,steps_executed:4,result:'pass',run_id:'1234',test_ids:['guest.compile','guest.run']};}
test('no-step receipt is allowed only as not-executed',()=>{const r=validateReceipt(base);assert.equal(r.claim_status,'UNVERIFIED_IMPORT');assert.equal(r.steps_executed,0);});
test('properly-shaped passing receipt still unverified',()=>{const r=validateReceipt(good());assert.equal(r.claim_status,'UNVERIFIED_IMPORT');});
test('zero steps cannot assert pass',()=>assert.throws(()=>validateReceipt({...good(),steps_executed:0}),/Zero executed/));
test('short SHA is rejected',()=>assert.throws(()=>validateReceipt({...good(),runtime_sha:'abcd'}),/runtime_sha/));
test('fake asset hash is rejected',()=>assert.throws(()=>validateReceipt({...good(),asset_sha256:'x'.repeat(64)}),/asset_sha256/));
test('missing workflow attempt is rejected',()=>assert.throws(()=>validateReceipt({...good(),attempt:0}),/attempt/));
test('noninteger job steps are rejected',()=>assert.throws(()=>validateReceipt({...good(),steps_executed:1.5}),/steps_executed/));
test('unrecognized artifact is rejected',()=>assert.throws(()=>validateReceipt({...good(),artifact_id:'evil'}),/artifact_id/));
test('unrecognized execution environment is rejected',()=>assert.throws(()=>validateReceipt({...good(),environment:'wasmtime-browser'}),/environment/));
test('excessive test IDs are rejected',()=>assert.throws(()=>validateReceipt({...good(),test_ids:Array(201).fill('x')}),/test_ids/));
test('arbitrary extra fields do not enter normalized record',()=>{const r=validateReceipt({...good(),secrets:'do not persist'});assert.ok(!('secrets' in r));});
test('no binary trust promotion field enters normalized record',()=>{const r=validateReceipt({...good(),claim_status:'CERTIFIED',externally_verified:true});assert.equal(r.claim_status,'UNVERIFIED_IMPORT');assert.ok(!('externally_verified' in r));});
