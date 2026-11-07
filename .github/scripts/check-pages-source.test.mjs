import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  checkPagesConfiguration, verifyPagesConfiguration, verifyMainProtection,
  PAGES_URL, MAIN_URL
} from './check-pages-source.mjs';

const SHA = 'a'.repeat(40);
const approved = {build_type:'workflow',https_enforced:true,public:true};
const protectedMain = {name:'main',protected:true,commit:{sha:SHA}};
const mockFetch = ({page=approved,main=protectedMain,onCall=()=>{}}={}) =>
  async (url,init) => {
    onCall(url,init);
    if (url === PAGES_URL) return {ok:true,redirected:false,json:async()=>page};
    if (url === MAIN_URL) return {ok:true,redirected:false,json:async()=>main};
    throw new Error('unexpected API endpoint: ' + url);
  };

test('Pages is eligible only when workflow source and HTTPS are enforced', () => {
  assert.equal(verifyPagesConfiguration(approved),true);
  for(const config of [
    null,{},[],{...approved,build_type:'legacy'}, {...approved,build_type:undefined},
    {...approved,https_enforced:false},{...approved,public:false},
    {...approved,public:'true'},{...approved,https_enforced:'true'}
  ]) assert.throws(()=>verifyPagesConfiguration(config),/Blocked|Missing/);
});

test('Protected main must match exact currently checked-out release SHA', () => {
  assert.equal(verifyMainProtection(protectedMain,SHA),true);
  for(const config of [
    null,{},[],{...protectedMain,protected:false},
    {...protectedMain,protected:'true'},
    {...protectedMain,name:'develop'},
    {...protectedMain,commit:null},
    {...protectedMain,commit:{sha:'b'.repeat(40)}}
  ]) assert.throws(()=>verifyMainProtection(config,SHA),/Blocked/);
  for(const expectedSha of [undefined,'','a'.repeat(39),'a'.repeat(41),'g'.repeat(40)])
    assert.throws(()=>verifyMainProtection(protectedMain,expectedSha),/Blocked/);
});

test('Read-only Pages and main checks use pinned GitHub endpoints and no redirects',async()=>{
  const calls=[];
  const result=await checkPagesConfiguration({token:'fake-test-token',expectedSha:SHA,
    fetchImpl:mockFetch({onCall:(url,init)=>{
      calls.push(url);
      assert.equal(init.headers.Authorization,'Bearer fake-test-token');
      assert.equal(init.redirect,'error');
      assert.equal(init.cache,'no-store');
      assert.ok(init.signal);
    }})
  });
  assert.deepEqual(calls,[PAGES_URL,MAIN_URL]);
  assert.deepEqual(result,{build_type:'workflow',https_enforced:true,main_protected:true});
});

test('Absent credentials, legacy mode, and unprotected main block release', async()=>{
  await assert.rejects(checkPagesConfiguration({token:'',expectedSha:SHA}),/Missing/);
  let mainRequests=0;
  await assert.rejects(checkPagesConfiguration({token:'x',expectedSha:SHA,
    fetchImpl:mockFetch({page:{...approved,build_type:'legacy'},
      onCall:url=>{if(url===MAIN_URL)mainRequests++}})
  }),/Blocked/);
  assert.equal(mainRequests,0,'legacy Pages gate aborts before main check');
  for(const main of [{...protectedMain,protected:false},
    {...protectedMain,commit:{sha:'b'.repeat(40)}},
    {...protectedMain,protected:undefined}]) {
    await assert.rejects(checkPagesConfiguration({token:'x',expectedSha:SHA,
      fetchImpl:mockFetch({main})}),/Blocked/);
  }
});

test('Any HTTP error, redirects, malformed or thrown JSON blocks publication', async()=>{
  for(const url of [PAGES_URL,MAIN_URL]) {
    for(const response of [
      {ok:false,status:403,redirected:false},
      {ok:false,status:404,redirected:false},
      {ok:false,status:302,redirected:false},
      {ok:true,redirected:true,json:async()=>approved},
      {ok:true,redirected:false,json:async()=>{throw new SyntaxError('invalid JSON')}}
    ]) {
      await assert.rejects(checkPagesConfiguration({token:'x',expectedSha:SHA,
        fetchImpl:async (candidate)=>{
          if(candidate===url) return response;
          return mockFetch()(candidate);
        }
      }),/unavailable|forbidden|invalid JSON/);
    }
  }
});

test('Malformed successful HTTP responses still fail closed', async()=>{
  for(const page of [null,[],{...approved,public:'true'}, {...approved,https_enforced:'true'}]) {
    await assert.rejects(checkPagesConfiguration({token:'x',expectedSha:SHA,
      fetchImpl:mockFetch({page})}),/Missing|Blocked/);
  }
  for(const main of [null,[],{}, {name:'main',protected:false,commit:{sha:SHA}}]) {
    await assert.rejects(checkPagesConfiguration({token:'x',expectedSha:SHA,
      fetchImpl:mockFetch({main})}),/Blocked/);
  }
});

test('Release workflow checks Pages and protected main before digest and dispatch deploy',async()=>{
  const workflow=await readFile(new URL('../workflows/approved-playground-pages.yml',import.meta.url),'utf8');
  assert.match(workflow,/pages: read/);
  assert.match(workflow,/contents: read/);
  assert.match(workflow,/check-pages-source\.mjs/);
  assert.ok(workflow.indexOf('check-pages-source.mjs') < workflow.indexOf('Enforce independently approved public compiler digest'));
  assert.match(workflow,/github\.event_name == 'workflow_dispatch'/);
  assert.match(workflow,/approved_compiler_sha256/);
  assert.match(workflow,/name: github-pages/);
});

test('CODEOWNERS covers the published artifact and release policy files',async()=>{
  const owners=await readFile(new URL('../CODEOWNERS',import.meta.url),'utf8');
  for(const entry of [
    '* @ORESoftware @the1mills',
    '/.github/workflows/* @ORESoftware @the1mills',
    '/.github/scripts/* @ORESoftware @the1mills',
    '/play/public/* @ORESoftware @the1mills'
  ]) assert.ok(owners.includes(entry), 'missing codeowner declaration '+entry);
  assert.match(owners,/[Ee]nforcement requires repository branch rules/);
});
