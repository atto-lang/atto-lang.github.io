import test from 'node:test';
import assert from 'node:assert/strict';
import {REPOS,rulesetFor,rulesMatch,refsMatch,environmentFor,environmentMatches,verified}
  from './admin-secure-pages.mjs';

test('both main rulesets have no bypass and require independent exact-head review',()=>{
  assert.equal(REPOS.length,2);
  for(const repo of REPOS){
    const spec=rulesetFor(repo);
    assert.equal(spec.enforcement,'active');
    assert.deepEqual(spec.bypass_actors,[]);
    assert.deepEqual(spec.conditions.ref_name.include,['refs/heads/main']);
    assert.equal(rulesMatch(spec.rules,repo),true);
    const r=spec.rules[2].parameters;
    for(const key of ['dismiss_stale_reviews_on_push','require_code_owner_review',
      'require_last_push_approval','required_review_thread_resolution']){
      r[key]=false;assert.equal(rulesMatch(spec.rules,repo),false,key);r[key]=true;
    }
    r.required_approving_review_count=0;
    assert.equal(rulesMatch(spec.rules,repo),false);
    r.required_approving_review_count=1;
    spec.rules[3].parameters.required_status_checks=[];
    assert.equal(rulesMatch(spec.rules,repo),false);
  }
  assert.throws(()=>rulesetFor('somewhere/else'),/E_ADMIN_REPOSITORY/);
});
test('Pages deployment requires protected branch and independent non-self review',()=>{
  assert.throws(()=>environmentFor(0),/E_ADMIN_REVIEWER_ID/);
  const desired=environmentFor(123);
  assert.deepEqual(desired.deployment_branch_policy,
    {protected_branches:true,custom_branch_policies:false});
  const env={deployment_branch_policy:desired.deployment_branch_policy,
    protection_rules:[{type:'required_reviewers',prevent_self_review:true,
      reviewers:[{type:'User',reviewer:{id:123}}]}]};
  assert.equal(environmentMatches(env,123),true);
  env.protection_rules[0].prevent_self_review=false;
  assert.equal(environmentMatches(env,123),false);
  env.protection_rules[0].prevent_self_review=true;
  assert.equal(environmentMatches(env,124),false);
  env.deployment_branch_policy.protected_branches=false;
  assert.equal(environmentMatches(env,123),false);
});
test('full release gate fails closed on absent rulesets, HTTP and legacy Pages',()=>{
  const s={reviewer:{id:123},
    repos:REPOS.map(repo=>({repo,branch:{name:'main',protected:true},
      existing:rulesetFor(repo)})),
    pages:{build_type:'workflow',https_enforced:true},
    env:{deployment_branch_policy:environmentFor(123).deployment_branch_policy,
      protection_rules:[{type:'required_reviewers',prevent_self_review:true,
        reviewers:[{type:'User',reviewer:{id:123}}]}]}
  };
  assert.equal(verified(s),true);
  s.pages.build_type='legacy';assert.equal(verified(s),false);
  s.pages.build_type='workflow';s.pages.https_enforced=false;
  assert.equal(verified(s),false);
  s.pages.https_enforced=true;s.repos[0].branch.protected=false;
  assert.equal(verified(s),false);
  s.repos[0].branch.protected=true;s.repos[0].existing=null;
  assert.equal(verified(s),false);
});

test('exact ruleset scope cannot point to another branch or add an administrator bypass',()=>{
  for(const repo of REPOS){
    const desired=rulesetFor(repo);
    assert.equal(refsMatch(desired.conditions),true);
    const bad=structuredClone(desired);
    bad.conditions.ref_name.include=['refs/heads/develop'];
    assert.equal(refsMatch(bad.conditions),false);
    bad.conditions.ref_name.include=['refs/heads/main','refs/heads/next'];
    assert.equal(refsMatch(bad.conditions),false);
    bad.conditions.ref_name.include=['refs/heads/main'];
    bad.conditions.ref_name.exclude=['refs/heads/main'];
    assert.equal(refsMatch(bad.conditions),false);
    bad.conditions.ref_name.exclude=[];
    bad.bypass_actors=[{actor_id:1,actor_type:'OrganizationAdmin',bypass_mode:'always'}];
    const snapshot={reviewer:{id:123},
      repos:[{repo,branch:{name:'main',protected:true},existing:bad}],
      pages:{build_type:'workflow',https_enforced:true},
      env:{deployment_branch_policy:environmentFor(123).deployment_branch_policy,
        protection_rules:[{type:'required_reviewers',prevent_self_review:true,
          reviewers:[{type:'User',reviewer:{id:123}}]}]}}
    };
    assert.equal(verified(snapshot,{siteOnly:repo===REPOS[0]}),false);
    if(repo===REPOS[0]){
      bad.bypass_actors=[];
      assert.equal(verified(snapshot,{siteOnly:true}),true);
      bad.conditions.ref_name.exclude=['refs/heads/main'];
      assert.equal(verified(snapshot,{siteOnly:true}),false);
    }
  }
});
