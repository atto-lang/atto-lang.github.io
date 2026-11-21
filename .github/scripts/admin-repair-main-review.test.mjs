import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REPO, RULESET_NAME, REVIEW_REPAIR_RULESET_ID, APP_ID, REQUIRED_CHECKS,
  API, rulesetPayload, verifyReviewRepairCandidate, repairMissingMainReviewRule,
  assertAllowedGitHubRequest
} from './admin-bootstrap-pages.mjs';

const sha = 'a'.repeat(40);
const clone = structuredClone;
const endpoint = API.rulesets + '/' + REVIEW_REPAIR_RULESET_ID;

// Reproduce the observed 2026-11-20 GitHub ruleset, without copying a token,
// private source, or trusting a simulated success as live governance.
function missingApproval() {
  return {
    id: REVIEW_REPAIR_RULESET_ID,
    name: RULESET_NAME, target: 'branch', enforcement: 'active',
    source_type: 'Repository', source: REPO, bypass_actors: [],
    conditions: {ref_name: {exclude: [], include: ['refs/heads/main']}},
    rules: [
      {type: 'deletion'},
      {type: 'non_fast_forward'},
      {type: 'required_status_checks', parameters: {
        strict_required_status_checks_policy: true,
        do_not_enforce_on_create: false,
        required_status_checks: REQUIRED_CHECKS.map(context => ({
          context, integration_id: APP_ID
        }))
      }}
    ]
  };
}

function fakeApi(current = missingApproval(), options={}) {
  let didPut = false, ruleReads = 0;
  const calls = [];
  const api = (method, path, payload) => {
    calls.push(method + ' ' + path);
    if (method === 'GET' && path === API.main)
      return {name:'main',protected:true,commit:{sha}};
    if (method === 'GET' && path === API.rulesets)
      return [{name:RULESET_NAME,id:REVIEW_REPAIR_RULESET_ID}];
    if (method === 'GET' && path === endpoint) {
      if (didPut) return { ...clone(current), ...rulesetPayload() };
      const snapshot = clone(current);
      ruleReads++;
      if (ruleReads === 2 && typeof options.mutateOnSecondRead === 'function')
        options.mutateOnSecondRead(snapshot);
      return snapshot;
    }
    if (method === 'GET' && path === API.active)
      return didPut ? clone(rulesetPayload().rules) : clone(current.rules);
    if (method === 'PUT' && path === endpoint) {
      assert.deepEqual(payload,rulesetPayload(),'repair may add only reviewed safe rule payload');
      didPut = true;
      return {id:REVIEW_REPAIR_RULESET_ID};
    }
    throw Error('Unexpected API: ' + method + ' ' + path);
  };
  return {api,put:payload=>api('PUT',endpoint,payload),calls,
    get didPut(){return didPut}};
}

test('observed exact-id ruleset is repairable, but only through an explicit guarded mutation',()=>{
  const old = missingApproval();
  assert.equal(verifyReviewRepairCandidate(old),true);
  assert.equal(old.rules.some(x => x.type === 'pull_request'),false);
  const ctx = fakeApi(old);
  const result = repairMissingMainReviewRule(ctx.api,{},ctx.put);
  assert.equal(ctx.didPut,true);
  assert.equal(ctx.calls.filter(x => x.startsWith('PUT ')).length,1);
  assert.equal(result.ruleset_id,REVIEW_REPAIR_RULESET_ID);
  assert.equal(result.release_dispatched,false);
  assert.equal(result.compiler_disclosure_approved,false);
});

test('ruleset repair refuses identity, bypass, scope, gate drift and unexpected rule mutations BEFORE PUT',()=>{
  const changes=[
    x=>x.id++,
    x=>x.name='unknown',
    x=>x.source='elsewhere/repo',
    x=>x.source_type='Organization',
    x=>x.target='tag',
    x=>x.enforcement='evaluate',
    x=>x.bypass_actors.push({actor_id:123,actor_type:'User',bypass_mode:'always'}),
    x=>x.conditions.ref_name.include=['refs/heads/*'],
    x=>x.conditions.ref_name.exclude=['refs/heads/main'],
    x=>x.rules.push({type:'pull_request',parameters:{required_approving_review_count:0}}),
    x=>x.rules.push({type:'creation'}),
    x=>x.rules.pop(),
    x=>x.rules[1].other='anything',
    x=>x.rules[2].parameters.strict_required_status_checks_policy=false,
    x=>x.rules[2].parameters.do_not_enforce_on_create=true,
    x=>x.rules[2].parameters.required_status_checks.pop(),
    x=>x.rules[2].parameters.required_status_checks[0].integration_id=1,
    x=>x.rules[2].parameters.required_status_checks[0].context='fake-check',
  ];
  for (const [i,change] of changes.entries()) {
    const current=missingApproval();
    change(current);
    const ctx=fakeApi(current);
    assert.throws(()=>repairMissingMainReviewRule(ctx.api,{},ctx.put),/Review repair refused/, 'mutation '+i);
    assert.equal(ctx.didPut,false,'mutation '+i+' unexpectedly wrote GitHub');
  }
});

test('repair stays disabled on CI runners and transport forbids unrelated admin endpoints',()=>{
  assert.throws(()=>repairMissingMainReviewRule(fakeApi().api,{CI:'true'},()=>{throw Error('must not write')}),/CI/);
  assert.throws(()=>assertAllowedGitHubRequest('PUT',endpoint,{CI:'true'}),/Refusing/);
  assert.throws(()=>assertAllowedGitHubRequest('PUT',endpoint,{}),/Refusing/,
    'the public ghApi transport must never bypass reviewed mutation admission');
  assert.throws(()=>assertAllowedGitHubRequest('PUT',endpoint,{GITHUB_RUN_ID:'42'}),/Refusing/);
  assert.throws(()=>assertAllowedGitHubRequest('PUT',API.rulesets+'/9999',{}),/Refusing/);
  assert.throws(()=>assertAllowedGitHubRequest('DELETE',endpoint,{}),/Refusing/);
  assert.throws(()=>assertAllowedGitHubRequest('PUT',API.pages+'/other',{}),/Refusing/);
  assert.doesNotThrow(()=>assertAllowedGitHubRequest('GET',endpoint,{}));
});

test('unexpected policy properties and a concurrent exact-ruleset edit never reach the write transport',()=>{
  const changes=[
    x=>x.conditions['repository_name']={include:['*'],exclude:[]},
    x=>x.conditions.ref_name.other=true,
    x=>x.rules[2].parameters.extra=true,
    x=>x.rules[2].extra=true,
    x=>x.rules[2].parameters.required_status_checks[0].spoofed=true,
  ];
  for(const [i,change] of changes.entries()) {
    const original=missingApproval();change(original);
    const ctx=fakeApi(original);
    assert.throws(()=>repairMissingMainReviewRule(ctx.api,{},ctx.put),
      /Review repair refused/, 'unexpected property '+i);
    assert.equal(ctx.didPut,false);
  }
  const drift=fakeApi(missingApproval(),{
    mutateOnSecondRead:x=>{x.updated_at='changed-during-admission'}
  });
  assert.throws(()=>repairMissingMainReviewRule(drift.api,{},drift.put),
    /ruleset changed during admission/);
  assert.equal(drift.didPut,false,'concurrent changes must fail before mutation');
});
