import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  ENVIRONMENT_URL, verifyDeploymentEnvironment, checkDeploymentEnvironment
} from './check-deployment-environment.mjs';

const valid = {
  name: 'github-pages', can_admins_bypass: false,
  deployment_branch_policy: { protected_branches: true, custom_branch_policies: false },
  protection_rules: [
    {type: 'required_reviewers', prevent_self_review: true, reviewers: [
      {type:'User',reviewer:{login:'ORESoftware'}},
      {type:'User',reviewer:{login:'the1mills'}}
    ]},
    {type:'branch_policy'}
  ]
};
const altered = mutate => { const e=structuredClone(valid); mutate(e); return e; };
function mockResponse(value=valid) {
  return {ok:true,redirected:false,status:200,json:async()=>value};
}

test('strict required reviewers, protected branches and no admin bypass qualify', () => {
  const result=verifyDeploymentEnvironment(valid);
  assert.deepEqual(result,{
    environment:'github-pages', protected_branches:true, prevent_self_review:true,
    admin_bypass_disabled:true, reviewers:2
  });
  assert.equal(verifyDeploymentEnvironment(altered(e=>{
    e.protection_rules[0].reviewers=[{type:'User',reviewer:{login:'ORESoftware'}}];
  })).reviewers,1);
});

test('missing environment, absent bypass attribute and incomplete branch policy block release', () => {
  for(const item of [null,undefined,[],{},altered(e=>e.name='dev'),
    altered(e=>{delete e.can_admins_bypass}),
    altered(e=>e.can_admins_bypass=true),
    altered(e=>e.can_admins_bypass='false'),
    altered(e=>e.deployment_branch_policy=null),
    altered(e=>e.deployment_branch_policy.protected_branches=false),
    altered(e=>e.deployment_branch_policy.custom_branch_policies=true),
    altered(e=>{delete e.deployment_branch_policy.custom_branch_policies})]) {
    assert.throws(()=>verifyDeploymentEnvironment(item),/Blocked/);
  }
});

test('reviewer rules fail closed on self-review, missing reviewers, teams or unknown users', () => {
  const cases=[
    e=>{delete e.protection_rules},
    e=>e.protection_rules=[],
    e=>e.protection_rules[0].prevent_self_review=false,
    e=>{delete e.protection_rules[0].prevent_self_review},
    e=>e.protection_rules[0].reviewers=[],
    e=>e.protection_rules[0].reviewers=null,
    e=>e.protection_rules[0].reviewers=[{type:'Team',reviewer:{slug:'release'}}],
    e=>e.protection_rules[0].reviewers=[{type:'User',reviewer:{login:'attacker'}}],
    e=>e.protection_rules[0].reviewers=[{type:'User',reviewer:{}}],
    e=>e.protection_rules[0].reviewers=[{type:'User',reviewer:{login:'ORESoftware'}},{type:'User',reviewer:{login:'oresoftware'}}],
    e=>e.protection_rules.push(structuredClone(e.protection_rules[0])),
    e=>e.protection_rules[0].reviewers.push({type:'User',reviewer:{login:'attacker'}})
  ];
  for(const [i,mutate] of cases.entries())
    assert.throws(()=>verifyDeploymentEnvironment(altered(mutate)),/Blocked/, 'case '+i);
});

test('reads only the exact GitHub environment URL without forwarding credentials on redirects', async () => {
  let count=0;
  const evidence=await checkDeploymentEnvironment({
    token:'test-only-token',
    fetchImpl: async (url, init)=>{
      count++;
      assert.equal(url,ENVIRONMENT_URL);
      assert.equal(init.method,'GET');
      assert.equal(init.headers.Authorization,'Bearer test-only-token');
      assert.equal(init.redirect,'error');
      assert.equal(init.cache,'no-store');
      assert.ok(init.signal);
      return mockResponse();
    }
  });
  assert.equal(count,1);
  assert.equal(evidence.admin_bypass_disabled,true);
});

test('missing API credentials, redirects, HTTP denial and invalid JSON cannot authorize publication', async () => {
  await assert.rejects(checkDeploymentEnvironment({token:''}),/Blocked/);
  for(const response of [
    {ok:false,status:403,redirected:false},
    {ok:false,status:404,redirected:false},
    {ok:false,status:302,redirected:false},
    {ok:true,status:200,redirected:true,json:async()=>valid},
    {ok:true,status:200,redirected:false,json:async()=>{throw new SyntaxError('invalid JSON')}},
    mockResponse(altered(e=>{delete e.can_admins_bypass})),
    null
  ]) {
    await assert.rejects(checkDeploymentEnvironment({token:'x',fetchImpl:async()=>response}));
  }
});

test('release verifies protected environment both before staging and again after approval', async () => {
  const flow=await readFile(new URL('../workflows/approved-playground-pages.yml',import.meta.url),'utf8');
  const preflight=flow.indexOf('Verify deployment environment has independent required reviewers');
  const compiler=flow.indexOf('Enforce independently approved public compiler digest on deploy');
  const after=flow.indexOf('Recheck protected deployment environment immediately before deploy');
  const deploy=flow.indexOf('uses: actions/deploy-pages@');
  assert.ok(preflight>0 && preflight<compiler,'preflight must run before compiler disclosure');
  assert.ok(after>compiler && after<deploy,'post-environment approval gate must run before deploy-pages');
  const hits=[...flow.matchAll(/node \.github\/scripts\/check-deployment-environment\.mjs/g)];
  assert.equal(hits.length,2);
  assert.match(flow,/actions: read/);
  assert.match(flow,/name: github-pages/);
});
