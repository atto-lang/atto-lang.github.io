import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyReleaseGovernance} from './verify-release-governance.mjs';

const path='/repos/atto-lang/atto-lang.github.io';
function response(data,status=200){
  return {ok:status>=200&&status<300,status,json:async()=>data};
}
function fixtures(){
  return {
    '/branches/main':{name:'main',protected:true},
    '/rules/branches/main?per_page=100':[
      {type:'pull_request',parameters:{
        required_approving_review_count:1,require_code_owner_review:true,
        require_last_push_approval:true,dismiss_stale_reviews_on_push:true}},
      {type:'required_status_checks',parameters:{required_status_checks:[
        {context:'browser-and-guest'},{context:'verify-public-artifact'}]}},
      {type:'deletion'},{type:'non_fast_forward'}
    ],
    '/pages':{build_type:'workflow',https_enforced:true},
    '/environments/github-pages':{
      name:'github-pages',
      deployment_branch_policy:{protected_branches:true},
      protection_rules:[{type:'required_reviewers',prevent_self_review:true,
        reviewers:[{type:'User',reviewer:{login:'ORESoftware'}}]}]
    }
  };
}
function checker(data,{deny=null,throwAt=null}={}){
  return verifyReleaseGovernance({
    token:'test-only-not-a-secret',
    request:async (url,opts)=>{
      assert.equal(opts.method,'GET');
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
test('missing token, API permissions, transport or malformed response fail closed',async()=>{
  await assert.rejects(verifyReleaseGovernance({token:''}),/Missing read-only/);
  await assert.rejects(checker(fixtures(),{deny:'/pages'}),/API denied/);
  await assert.rejects(checker(fixtures(),{throwAt:'/pages'}),/API inaccessible/);
  const d=fixtures();d['/rules/branches/main?per_page=100']=[];
  await assert.rejects(checker(d),/Require PR/);
});
