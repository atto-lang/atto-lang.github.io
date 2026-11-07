import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  REPO,RULESET_NAME,APP_ID,API,rulesetPayload,environmentPayload,
  verifyPages,verifyBranch,verifyRules,verifyRuleset,verifyEnvironment,
  readState,verifyState,applySettings,CI_MARKERS,
  assertLocalAdminOnly,assertAllowedGitHubRequest,ghApi
} from './admin-bootstrap-pages.mjs';

const sha='a'.repeat(40);
const pages={build_type:'workflow',https_enforced:true,public:true};
const branch={name:'main',protected:true,commit:{sha}};
const reviewers=[
  {type:'User',reviewer:{login:'ORESoftware',id:201}},
  {type:'User',reviewer:{login:'the1mills',id:202}}
];
const environment={
  name:'github-pages',can_admins_bypass:false,
  deployment_branch_policy:{protected_branches:true,custom_branch_policies:false},
  protection_rules:[{type:'required_reviewers',prevent_self_review:true,reviewers}]
};
const ruleset={id:300,...rulesetPayload()};
const clone=x=>structuredClone(x);
const expectBlocked=(fn)=>assert.throws(fn,/missing|insufficient|differs|not |No |invalid|Unexpected|unavailable|protected|refusing/i);

test('ruleset expresses exact active no-bypass codeowner, GitHub Actions and history protection',()=>{
  const r=rulesetPayload();
  assert.equal(r.target,'branch');
  assert.equal(r.enforcement,'active');
  assert.deepEqual(r.bypass_actors,[]);
  assert.deepEqual(r.conditions.ref_name,{include:['refs/heads/main'],exclude:[]});
  assert.deepEqual(r.rules.map(x=>x.type),['pull_request','required_status_checks','non_fast_forward','deletion']);
  assert.equal(r.rules[0].parameters.required_approving_review_count,1);
  assert.equal(r.rules[0].parameters.require_code_owner_review,true);
  assert.equal(r.rules[0].parameters.require_last_push_approval,true);
  assert.equal(r.rules[0].parameters.dismiss_stale_reviews_on_push,true);
  assert.deepEqual(r.rules[1].parameters.required_status_checks,[{context:'verify-public-artifact',integration_id:APP_ID}]);
  assert.equal(verifyRuleset(ruleset),true);
  assert.equal(verifyRules(ruleset.rules),true);
});

test('ruleset tampering rejects bypass, stale review, wrong status-app, wrong targeting and inactive gates',()=>{
  const variants=[
    r=>r.bypass_actors.push({actor_type:'User',actor_id:201,bypass_mode:'always'}),
    r=>{delete r.bypass_actors},
    r=>r.enforcement='evaluate',
    r=>r.target='tag',
    r=>r.conditions.ref_name.include=['refs/heads/*'],
    r=>r.rules[0].parameters.require_last_push_approval=false,
    r=>r.rules[0].parameters.require_code_owner_review=false,
    r=>r.rules[1].parameters.required_status_checks[0].integration_id=15369,
    r=>r.rules[1].parameters.strict_required_status_checks_policy=false,
    r=>r.rules=r.rules.filter(rule=>rule.type!=='non_fast_forward'),
    r=>r.rules=r.rules.filter(rule=>rule.type!=='deletion'),
    r=>r.name='Attacker rule'
  ];
  for(const [i,mutate] of variants.entries()){
    const bad=clone(ruleset);mutate(bad);
    assert.throws(()=>verifyRuleset(bad),undefined,'mutation '+i+' must fail');
  }
});

test('environment uses two verified distinct IDs and never permits self-review or admin bypass',()=>{
  const desired=environmentPayload([201,202]);
  assert.equal(desired.prevent_self_review,true);
  assert.equal(desired.can_admins_bypass,false);
  assert.deepEqual(desired.reviewers,[{type:'User',id:201},{type:'User',id:202}]);
  assert.deepEqual(desired.deployment_branch_policy,{protected_branches:true,custom_branch_policies:false});
  assert.equal(verifyEnvironment(environment,'the1mills'),true);
  for(const ids of [[],[201],[201,201],[0,202],[201,'202']])
    assert.throws(()=>environmentPayload(ids));
});

test('environment mutation negatives: wrong user, bypass, branch exposure, missing reviewer rule',()=>{
  const mutants=[
    e=>e.can_admins_bypass=true,
    e=>{delete e.can_admins_bypass},
    e=>e.deployment_branch_policy=null,
    e=>e.deployment_branch_policy.protected_branches=false,
    e=>e.deployment_branch_policy.custom_branch_policies=true,
    e=>e.protection_rules[0].prevent_self_review=false,
    e=>e.protection_rules=[],
    e=>e.protection_rules.push(clone(e.protection_rules[0])),
    e=>e.protection_rules[0].reviewers=[{type:'User',reviewer:{login:'the1mills'}}],
    e=>e.protection_rules[0].reviewers[0].reviewer.login='untrusted',
    e=>e.protection_rules[0].reviewers[1].reviewer.login='ORESoftware'
  ];
  for(const [i,mutate] of mutants.entries()){
    const e=clone(environment);mutate(e);
    assert.throws(()=>verifyEnvironment(e),undefined,'environment mutation '+i+' must fail');
  }
});

function fakeGitHub({unsafePages=true,unsafeEnvironment=true, existingRules=false, ignoreAdminBypass=false}={}){
  let state={
    pages:unsafePages?{...pages,build_type:'legacy'}:clone(pages),
    main:{...branch,protected:existingRules},
    rulesets:existingRules?[clone(ruleset)]:[],
    environment:unsafeEnvironment?null:clone(environment),
    active:existingRules?clone(ruleset.rules):[]
  };
  const calls=[];
  const api=(method,endpoint,body)=>{
    calls.push({method,endpoint});
    if(method==='GET'){
      if(endpoint===API.pages)return clone(state.pages);
      if(endpoint===API.main)return clone(state.main);
      if(endpoint===API.rulesets)return state.rulesets.map(x=>({id:x.id,name:x.name}));
      if(endpoint===API.active)return clone(state.active);
      if(endpoint===API.environment)return clone(state.environment);
      if(endpoint===API.rulesets+'/300')return clone(state.rulesets.find(x=>x.id===300));
      if(endpoint==='users/ORESoftware')return {id:201,login:'ORESoftware'};
      if(endpoint==='users/the1mills')return {id:202,login:'the1mills'};
      throw new Error('unexpected GET endpoint '+endpoint);
    }
    if(method==='PUT'&&endpoint===API.pages){state.pages={...state.pages,...body};return null;}
    if(method==='POST'&&endpoint===API.rulesets){
      state.rulesets.push({id:300,...clone(body)});
      state.active=clone(body.rules);
      state.main.protected=true;
      return {id:300};
    }
    if(method==='PUT'&&endpoint===API.environment){
      state.environment={...environment,can_admins_bypass:ignoreAdminBypass?true:body.can_admins_bypass,
        deployment_branch_policy:body.deployment_branch_policy,
        protection_rules:[{type:'required_reviewers',prevent_self_review:body.prevent_self_review,reviewers}]};
      return clone(state.environment);
    }
    throw new Error('Unexpected mutation '+method+' '+endpoint);
  };
  return {api,calls,state};
}

test('admin bootstrap fixes legacy source first, creates ruleset, protects environment, verifies readback',()=>{
  const mock=fakeGitHub();
  const receipt=applySettings(mock.api);
  assert.equal(receipt.status,'ADMIN_POLICY_VERIFIED');
  assert.equal(receipt.main_head,sha);
  assert.equal(receipt.release_dispatched,false);
  assert.equal(mock.calls[0].endpoint,API.pages);
  const writes=mock.calls.filter(x=>x.method!=='GET');
  assert.deepEqual(writes.map(x=>[x.method,x.endpoint]),[
    ['PUT',API.pages],['POST',API.rulesets],['PUT',API.environment]
  ]);
  assert.equal(verifyState(readState(mock.api),mock.api).status,'ADMIN_POLICY_VERIFIED');
  assert.equal(mock.calls.some(x=>/deployments|dispatches|merges|pulls/.test(x.endpoint)),false);
});

test('running bootstrap again on verified policy is idempotent, with zero writes',()=>{
  const mock=fakeGitHub({unsafePages:false,unsafeEnvironment:false,existingRules:true});
  assert.equal(applySettings(mock.api).status,'ADMIN_POLICY_VERIFIED');
  assert.equal(mock.calls.filter(x=>x.method!=='GET').length,0);
});

test('ignored admin-bypass update fails closed: never claim secure deployment',()=>{
  const mock=fakeGitHub({ignoreAdminBypass:true});
  assert.throws(()=>applySettings(mock.api),/no-bypass restrictions/);
  assert.equal(mock.calls.some(x=>/dispatches|deployments/.test(x.endpoint)),false);
});

test('read-only audit fails on incomplete published settings, unprotected main, and missing environment',()=>{
  const mock=fakeGitHub();
  assert.throws(()=>verifyState(readState(mock.api),mock.api));
  expectBlocked(()=>verifyPages({...pages,build_type:'legacy'}));
  expectBlocked(()=>verifyBranch({...branch,protected:false}));
  expectBlocked(()=>verifyRules([]));
  expectBlocked(()=>verifyEnvironment(null));
});

test('script never retrieves or prints a token and never uses webhook or CI deploy capability',async()=>{
  const source=await readFile(new URL('./admin-bootstrap-pages.mjs',import.meta.url),'utf8');
  assert.ok(source.includes("'--apply'"));
  assert.ok(source.includes("'--confirm'"));
  assert.ok(source.includes("'--verify'"));
  assert.ok(source.includes("'--hostname', 'github.com'"));
  for(const forbidden of ['gh auth token','actions/workflows/approved-playground-pages.yml/dispatches','pages/deployments','merge_pull_request'])
    assert.ok(!source.includes(forbidden),'unexpected sensitive action '+forbidden);
  assert.equal(REPO,'atto-lang/atto-lang.github.io');
  assert.equal(RULESET_NAME,'AttoLang protected main release');
});
test('privileged admin bootstrap rejects CI and GitHub Actions contexts before any network or gh call', () => {
  const script=fileURLToPath(new URL('./admin-bootstrap-pages.mjs',import.meta.url));
  const flags=['--apply','--confirm',REPO];
  for(const envDelta of [
    {CI:'true'},
    {GITHUB_ACTIONS:'true'},
    {GITHUB_WORKFLOW:'untrusted-pr'},
    {GITHUB_RUN_ID:'12345'}
  ]) {
    const env={...process.env,CI:'',GITHUB_ACTIONS:'',GITHUB_WORKFLOW:'',GITHUB_RUN_ID:'',...envDelta};
    const x=spawnSync(process.execPath,[script,...flags],{
      encoding:'utf8',env,timeout:5000
    });
    assert.equal(x.status,1,'CI must not be able to mutate environment: '+JSON.stringify(envDelta));
    assert.match(x.stderr,/Refusing administrative mutation inside CI/);
    assert.ok(!x.stdout.includes('ADMIN_POLICY_VERIFIED'));
    assert.ok(!x.stderr.includes('GitHub API request failed'),
      'policy refusal must happen before attempting gh API calls');
  }
});

test('all supported API methods and paths are exactly allowlisted and CI cannot write',()=>{
  for(const read of [API.pages,API.main,API.rulesets,API.active,API.environment,
    API.rulesets+'/300','users/ORESoftware','users/the1mills']) {
    assert.doesNotThrow(()=>assertAllowedGitHubRequest('GET',read,{CI:'1'}));
  }
  for(const [method,endpoint] of [
    ['POST',API.rulesets],['PUT',API.pages],['PUT',API.environment]
  ]) {
    assert.doesNotThrow(()=>assertAllowedGitHubRequest(method,endpoint,{}));
    assert.throws(()=>assertAllowedGitHubRequest(method,endpoint,{CI:'1'}),/inside CI/);
  }
  for(const [method,endpoint] of [
    ['DELETE',API.rulesets],['POST',API.pages],['PATCH',API.environment],
    ['PUT',API.main],['GET','repos/'+REPO+'/actions/secrets'],
    ['GET',API.rulesets+'/../environment'],
    ['GET',API.rulesets+'/0'],['GET',API.rulesets+'/1?token=secret'],
    ['POST','repos/'+REPO+'/actions/workflows/approved-playground-pages.yml/dispatches'],
    ['GET','users/untrusted'],['GET','/users/ORESoftware'],
    ['GET','https://api.evil.invalid/repos/'+REPO]
  ]) assert.throws(()=>assertAllowedGitHubRequest(method,endpoint,{}),/unexpected GitHub API/);
});

test('all nonempty CI marker spellings fail closed before privileged API access',()=>{
  for(const marker of CI_MARKERS) {
    for(const value of ['1','yes','TRUE','false']) {
      assert.throws(()=>assertLocalAdminOnly({[marker]:value}),/inside CI/,
        marker+'='+value);
      assert.throws(()=>assertAllowedGitHubRequest('POST',API.rulesets,{[marker]:value}),/inside CI/);
    }
  }
  assert.doesNotThrow(()=>assertLocalAdminOnly({}));
});

test('direct invocation of exported privileged helper rejects CI before executing gh',()=>{
  const script=fileURLToPath(new URL('./admin-bootstrap-pages.mjs',import.meta.url));
  const source=`import { ghApi, API } from ${JSON.stringify('file://' + script)}; ghApi('PUT',API.pages,{build_type:'workflow'});`;
  const env={...process.env,CI:'1',GITHUB_ACTIONS:'',GITHUB_WORKFLOW:'',GITHUB_RUN_ID:''};
  const result=spawnSync(process.execPath,['--input-type=module','-e',source],{
    encoding:'utf8',env,timeout:5000
  });
  assert.equal(result.status,1);
  assert.match(result.stderr,/Refusing administrative mutation inside CI/);
  assert.ok(!result.stderr.includes('GitHub API request failed'));
});
