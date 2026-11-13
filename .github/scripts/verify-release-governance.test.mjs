import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyReleaseGovernance} from './verify-release-governance.mjs';

const path='/repos/atto-lang/atto-lang.github.io';
function response(data,status=200){
  return {ok:status>=200&&status<300,status,json:async()=>data};
}
function fixtures(){
  return {
    '/branches/main':{name:'main',protected:true,commit:{sha:'a'.repeat(40)}},
    '/rules/branches/main?per_page=100':[
      {type:'pull_request',parameters:{
        required_approving_review_count:1,require_code_owner_review:true,
        require_last_push_approval:true,dismiss_stale_reviews_on_push:true}},
      {type:'required_status_checks',parameters:{strict_required_status_checks_policy:true,
        required_status_checks:[
        {context:'browser-and-guest',integration_id:15368},
        {context:'verify-public-artifact',integration_id:15368}]}},
      {type:'deletion'},{type:'non_fast_forward'}
    ],
    '/rulesets?per_page=100':[
      {id:72,name:'atto-main-independent-review-v1',target:'branch',enforcement:'active'}
    ],
    '/rulesets/72':{
      id:72,name:'atto-main-independent-review-v1',
      target:'branch',enforcement:'active',bypass_actors:[],
      conditions:{ref_name:{include:['refs/heads/main'],exclude:[]}},
      rules:[
        {type:'pull_request',parameters:{
          required_approving_review_count:1,require_code_owner_review:true,
          require_last_push_approval:true,dismiss_stale_reviews_on_push:true,
          required_review_thread_resolution:true
        }},
        {type:'required_status_checks',parameters:{
          strict_required_status_checks_policy:true,
          required_status_checks:[
            {context:'browser-and-guest',integration_id:15368},
            {context:'verify-public-artifact',integration_id:15368}
          ]
        }},
        {type:'deletion'},{type:'non_fast_forward'}
      ]
    },
    '/pages':{build_type:'workflow',https_enforced:true},
    '/environments/github-pages':{
      name:'github-pages',can_admins_bypass:false,
      deployment_branch_policy:{protected_branches:true},
      protection_rules:[{type:'required_reviewers',prevent_self_review:true,
        reviewers:[{type:'User',reviewer:{login:'ORESoftware'}}]}]
    }
  };
}
function checker(data,{deny=null,throwAt=null}={}){
  return verifyReleaseGovernance({
    token:'test-only-not-a-secret',
    expectedHead:'a'.repeat(40),
    request:async (url,opts)=>{
      assert.equal(opts.method,'GET');
      assert.equal(opts.redirect,'error');
      assert.match(opts.headers.Authorization,/^Bearer /);
      const p=new URL(url).pathname+new URL(url).search;
      assert.ok(p.startsWith(path),'unexpected API host/path');
      const key=p.slice(path.length);
      if(key===throwAt)throw Error('network down');
      if(key===deny)return response({message:'denied'},403);
      assert.ok(Object.hasOwn(data,key),'unexpected route '+key);
      return response(data[key]);
    }
  });
}

test('preflight accepts only fully observed protected release governance',async()=>{
  const result=await checker(fixtures());
  assert.equal(result.repository,'atto-lang/atto-lang.github.io');
  assert.deepEqual(result.checks,['browser-and-guest','verify-public-artifact']);
});
test('preflight fails closed on missing or unprotected main branch',async()=>{
  const a=fixtures();a['/branches/main'].protected=false;
  await assert.rejects(checker(a),/main is not protected/);
  const b=fixtures();b['/branches/main'].name='dev';
  await assert.rejects(checker(b),/main is not protected/);
});
test('release requires exact unchanged protected main SHA',async()=>{
  const changed=fixtures();
  changed['/branches/main'].commit.sha='b'.repeat(40);
  await assert.rejects(checker(changed),/head drifted/);
  const missing=fixtures();
  delete missing['/branches/main'].commit;
  await assert.rejects(checker(missing),/head drifted/);
  await assert.rejects(verifyReleaseGovernance({
    token:'test',expectedHead:'invalid'
  }),/malformed expected release head/);
});
test('review gates and last-push approval cannot be disabled',async()=>{
  for(const field of ['required_approving_review_count','require_code_owner_review',
    'require_last_push_approval','dismiss_stale_reviews_on_push']){
    const d=fixtures();d['/rules/branches/main?per_page=100'][0].parameters[field]=
      field==='required_approving_review_count'?0:false;
    await assert.rejects(checker(d),/Require PR/);
  }
});
test('missing exact CI, deletion or force-push protection aborts',async()=>{
  for(const type of ['required_status_checks','deletion','non_fast_forward']){
    const d=fixtures();
    d['/rules/branches/main?per_page=100']=
      d['/rules/branches/main?per_page=100'].filter(x=>x.type!==type);
    await assert.rejects(checker(d),/Required exact CI|Branch protection rule/);
  }
  const d=fixtures();
  d['/rules/branches/main?per_page=100'][1].parameters.required_status_checks
    .splice(1,1);
  await assert.rejects(checker(d),/verify-public-artifact/);
});
test('release CI must be strict and originate from GitHub Actions app',async()=>{
  const spoof=fixtures();
  spoof['/rules/branches/main?per_page=100'][1].parameters
    .required_status_checks[0].integration_id=null;
  await assert.rejects(checker(spoof),/untrusted GitHub Actions source: browser-and-guest/);
  const other=fixtures();
  other['/rules/branches/main?per_page=100'][1].parameters
    .required_status_checks[1].integration_id=42;
  await assert.rejects(checker(other),/untrusted GitHub Actions source: verify-public-artifact/);
  const loose=fixtures();
  loose['/rules/branches/main?per_page=100'][1].parameters
    .strict_required_status_checks_policy=false;
  await assert.rejects(checker(loose),/untrusted/);
});
test('Pages cannot use branch-source or HTTP publication',async()=>{
  for(const [field,value] of [['build_type','legacy'],['https_enforced',false]]){
    const d=fixtures();d['/pages'][field]=value;
    await assert.rejects(checker(d),/Actions-only publication/);
  }
});
test('deployment requires protected-branch policy and independent non-self reviewer',async()=>{
  const a=fixtures();
  a['/environments/github-pages'].deployment_branch_policy.protected_branches=false;
  await assert.rejects(checker(a),/protected branches only/);
  for(const override of [
    {prevent_self_review:false},
    {reviewers:[{type:'User',reviewer:{login:'the1mills'}}]},
    {type:'wait_timer'}
  ]){
    const d=fixtures();
    Object.assign(d['/environments/github-pages'].protection_rules[0],override);
    await assert.rejects(checker(d),/Independent ORESoftware/);
  }
});
test('administrator bypass enabled or unreported aborts release',async()=>{
  const bypass=fixtures();
  bypass['/environments/github-pages'].can_admins_bypass=true;
  await assert.rejects(checker(bypass),/administrator approval bypass/);
  const unknown=fixtures();
  delete unknown['/environments/github-pages'].can_admins_bypass;
  await assert.rejects(checker(unknown),/administrator approval bypass/);
});
test('missing token, API permissions, transport or malformed response fail closed',async()=>{
  await assert.rejects(verifyReleaseGovernance({token:''}),/Missing read-only/);
  await assert.rejects(checker(fixtures(),{deny:'/pages'}),/API denied/);
  await assert.rejects(checker(fixtures(),{throwAt:'/pages'}),/API inaccessible/);
  const d=fixtures();d['/rules/branches/main?per_page=100']=[];
  await assert.rejects(checker(d),/Require PR/);
});

test('release refuses absent, duplicate, truncated or unidentifiable no-bypass rulesets',async()=>{
  const mutations=[
    d=>{d['/rulesets?per_page=100']=[];},
    d=>{d['/rulesets?per_page=100']=null;},
    d=>{d['/rulesets?per_page=100']=Array(100).fill({id:72,name:'x'});},
    d=>{d['/rulesets?per_page=100'].push({...d['/rulesets?per_page=100'][0]});},
    d=>{d['/rulesets?per_page=100'][0].id='72';}
  ];
  for(const mutate of mutations){
    const d=fixtures();mutate(d);
    await assert.rejects(checker(d),/no-bypass main ruleset/);
  }
  await assert.rejects(checker(fixtures(),{deny:'/rulesets/72'}),/API denied/);
});

test('release rejects bypass principals, inactive or broad ruleset scope',async()=>{
  const mutations=[
    d=>{d['/rulesets/72'].bypass_actors=[{actor_id:123,actor_type:'OrganizationAdmin'}];},
    d=>{delete d['/rulesets/72'].bypass_actors;},
    d=>{d['/rulesets/72'].enforcement='evaluate';},
    d=>{d['/rulesets/72'].target='tag';},
    d=>{d['/rulesets/72'].name='unreviewed';},
    d=>{d['/rulesets/72'].conditions.ref_name.include=['refs/heads/*'];},
    d=>{d['/rulesets/72'].conditions.ref_name.exclude=['refs/heads/main'];},
    d=>{d['/rulesets/72'].id=73;}
  ];
  for(const mutate of mutations){
    const d=fixtures();mutate(d);
    await assert.rejects(checker(d),/no-bypass main ruleset/);
  }
});

test('named ruleset itself must enforce independent review and trusted CI',async()=>{
  const mutations=[
    d=>{d['/rulesets/72'].rules.find(r=>r.type==='pull_request').parameters.required_approving_review_count=0;},
    d=>{d['/rulesets/72'].rules.find(r=>r.type==='pull_request').parameters.require_code_owner_review=false;},
    d=>{d['/rulesets/72'].rules.find(r=>r.type==='pull_request').parameters.required_review_thread_resolution=false;},
    d=>{d['/rulesets/72'].rules.find(r=>r.type==='required_status_checks').parameters.strict_required_status_checks_policy=false;},
    d=>{d['/rulesets/72'].rules.find(r=>r.type==='required_status_checks').parameters.required_status_checks[0].integration_id=null;},
    d=>{d['/rulesets/72'].rules=d['/rulesets/72'].rules.filter(r=>r.type!=='non_fast_forward');}
  ];
  for(const mutate of mutations){
    const d=fixtures();mutate(d);
    await assert.rejects(checker(d),/Named no-bypass main ruleset/);
  }
});
