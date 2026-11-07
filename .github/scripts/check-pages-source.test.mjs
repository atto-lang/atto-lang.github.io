import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { checkPagesConfiguration, verifyPagesConfiguration, PAGES_URL } from './check-pages-source.mjs';
const approved = {build_type:'workflow',https_enforced:true,public:true};
test('Pages is eligible only when workflow source and HTTPS are enforced', () => {
  assert.equal(verifyPagesConfiguration(approved),true);
  for(const config of [
    null,{},[],{...approved,build_type:'legacy'}, {...approved,build_type:undefined},
    {...approved,https_enforced:false},{...approved,public:false}
  ]) assert.throws(()=>verifyPagesConfiguration(config),/Blocked|Missing/);
});
test('Checks the actual repository Pages endpoint with an authenticated read',async()=>{
  let calls=0;
  const result=await checkPagesConfiguration({token:'fake-test-token',fetchImpl:async(url,init)=>{
    calls++;
    assert.equal(url,PAGES_URL);
    assert.equal(init.headers.Authorization,'Bearer fake-test-token');
    assert.ok(init.signal);
    return {ok:true,json:async()=>approved};
  }});
  assert.equal(calls,1);
  assert.deepEqual(result,{build_type:'workflow',https_enforced:true});
});
test('API errors and absent permissions are release blockers, not passes',async()=>{
  await assert.rejects(checkPagesConfiguration({token:''}),/Missing/);
  await assert.rejects(checkPagesConfiguration({token:'x',fetchImpl:async()=>({ok:false,status:403})}),/settings unavailable/);
  await assert.rejects(checkPagesConfiguration({token:'x',fetchImpl:async()=>({ok:true,json:async()=>({build_type:'legacy'})})}),/Blocked/);
});
test('Release workflow checks GitHub Pages mode before digest and dispatch deploy',async()=>{
  const workflow=await readFile(new URL('../workflows/approved-playground-pages.yml',import.meta.url),'utf8');
  assert.match(workflow,/pages: read/);
  assert.match(workflow,/check-pages-source\.mjs/);
  assert.ok(workflow.indexOf('check-pages-source.mjs') < workflow.indexOf('Enforce independently approved public compiler digest'));
  assert.match(workflow,/github\.event_name == 'workflow_dispatch'/);
  assert.match(workflow,/approved_compiler_sha256/);
  assert.match(workflow,/name: github-pages/);
});
