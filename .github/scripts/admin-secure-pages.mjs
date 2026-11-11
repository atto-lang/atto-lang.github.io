// Authenticated administrator CLI; never runs under PR CI.
// Default is read-only. Applying requires --apply AND ATTO_ADMIN_APPLY=YES.
// Never merges, changes compiler approval variables, or deploys.
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export const REPOS=['atto-lang/atto-lang.github.io','atto-lang/atto-source.rs'];
export const RULESET_NAME='atto-main-independent-review-v1';
export const CHECKS={
  'atto-lang/atto-lang.github.io':['browser-and-guest','verify-public-artifact'],
  'atto-lang/atto-source.rs':['real-compiler']
};
export function rulesetFor(repo) {
  if(!REPOS.includes(repo))throw Error('E_ADMIN_REPOSITORY');
  return {
    name:RULESET_NAME,target:'branch',enforcement:'active',bypass_actors:[],
    conditions:{ref_name:{include:['refs/heads/main'],exclude:[]}},
    rules:[
      {type:'deletion'},{type:'non_fast_forward'},
      {type:'pull_request',parameters:{
        required_approving_review_count:1,
        dismiss_stale_reviews_on_push:true,require_code_owner_review:true,
        require_last_push_approval:true,required_review_thread_resolution:true,
        allowed_merge_methods:['merge','squash','rebase']
      }},
      {type:'required_status_checks',parameters:{
        strict_required_status_checks_policy:true,
        required_status_checks:CHECKS[repo].map(context=>({context}))
      }}
    ]
  };
}
export function environmentFor(id){
  if(!Number.isSafeInteger(id)||id<1)throw Error('E_ADMIN_REVIEWER_ID');
  return {wait_timer:0,prevent_self_review:true,
    reviewers:[{type:'User',id}],
    deployment_branch_policy:{protected_branches:true,custom_branch_policies:false}};
}
export function rulesMatch(rules,repo){
  if(!Array.isArray(rules))return false;
  const byType=new Map(rules.map(x=>[x.type,x]));
  const r=byType.get('pull_request')?.parameters;
  const c=byType.get('required_status_checks')?.parameters;
  const contexts=new Set((c?.required_status_checks||[]).map(x=>x.context));
  return REPOS.includes(repo)&&byType.has('deletion')&&byType.has('non_fast_forward')&&
    r?.required_approving_review_count>=1&&
    r.dismiss_stale_reviews_on_push===true&&
    r.require_code_owner_review===true&&
    r.require_last_push_approval===true&&
    r.required_review_thread_resolution===true&&
    c?.strict_required_status_checks_policy===true&&
    CHECKS[repo].every(x=>contexts.has(x));
}
export function environmentMatches(env,id){
  const p=env?.deployment_branch_policy;
  const review=env?.protection_rules?.find(x=>x.type==='required_reviewers');
  return p?.protected_branches===true&&p?.custom_branch_policies===false&&
    review?.prevent_self_review===true&&
    review?.reviewers?.length===1&&
    review.reviewers[0].type==='User'&&review.reviewers[0].reviewer?.id===id;
}
function api(method,endpoint,body){
  const args=['api',endpoint];
  if(method!=='GET')args.push('--method',method,'--input','-');
  const r=spawnSync('gh',args,{encoding:'utf8',
    input:body===undefined?undefined:JSON.stringify(body),maxBuffer:2000000});
  if(r.error)throw Error('gh CLI unavailable: '+r.error.message);
  if(r.status!==0){
    if(/Upgrade to GitHub Pro|make this repository public/i.test(r.stderr||''))
      throw Error('E_ADMIN_PRIVATE_RULESET_UNAVAILABLE: private compiler rulesets require an eligible GitHub plan. Do NOT make the compiler public. Use --check-site / --apply-site for the public Pages repository only, and track compiler protection separately.');
    throw Error('GitHub rejected '+method+' '+endpoint+
      ': '+String(r.stderr||'').slice(0,300));
  }
  if(!r.stdout?.trim())return null;
  return JSON.parse(r.stdout);
}
function inspect({siteOnly=false}={}){
  const admin=api('GET','/user'),reviewer=api('GET','/users/ORESoftware');
  if(!Number.isSafeInteger(reviewer.id))throw Error('Cannot resolve reviewer ID');
  const repos=(siteOnly?REPOS.slice(0,1):REPOS).map(repo=>{
    const prefix='/repos/'+repo;
    const branch=api('GET',prefix+'/branches/main');
    const list=api('GET',prefix+'/rulesets?per_page=100');
    if(branch?.name!=='main'||!Array.isArray(list)||list.length>=100)
      throw Error('Incomplete branch/rulesets response: '+repo);
    const found=list.find(x=>x.name===RULESET_NAME);
    const existing=found?api('GET',prefix+'/rulesets/'+found.id):null;
    if(existing&&(
      existing.enforcement!=='active'||existing.target!=='branch'||
      (existing.bypass_actors||[]).length>0||
      !refsMatch(existing.conditions)||
      !rulesMatch(existing.rules,repo)))
      throw Error('Existing named ruleset differs: review manually for '+repo);
    return {repo,branch,existing};
  });
  const prefix='/repos/'+REPOS[0];
  const pages=api('GET',prefix+'/pages');
  const env=api('GET',prefix+'/environments/github-pages');
  if(env?.name!=='github-pages')throw Error('Missing GitHub Pages environment');
  const other=env.protection_rules?.filter(x=>x.type==='required_reviewers')
    .flatMap(x=>x.reviewers||[])
    .filter(x=>x.reviewer?.id!==reviewer.id)||[];
  if(other.length)throw Error('Existing environment reviewers need manual reconciliation');
  return {admin,reviewer,repos,pages,env};
}
export function refsMatch(conditions){
  const r=conditions?.ref_name;
  return Array.isArray(r?.include)&&r.include.length===1&&
    r.include[0]==='refs/heads/main'&&
    Array.isArray(r.exclude)&&r.exclude.length===0;
}
export function verified(s,{siteOnly=false}={}){
  const expected=siteOnly?REPOS.slice(0,1):REPOS;
  return Array.isArray(s.repos)&&s.repos.length===expected.length&&
    s.repos.every((x,i)=>x.repo===expected[i]&&x.branch.name==='main'&&
      x.branch.protected===true&&x.existing&&
      x.existing.target==='branch'&&x.existing.enforcement==='active'&&
      Array.isArray(x.existing.bypass_actors)&&x.existing.bypass_actors.length===0&&
      refsMatch(x.existing.conditions)&&rulesMatch(x.existing.rules,x.repo))&&
    s.pages.build_type==='workflow'&&s.pages.https_enforced===true&&
    environmentMatches(s.env,s.reviewer.id);
}
function main(){
  const action=process.argv[2];
  if(!['--check','--apply','--check-site','--apply-site'].includes(action)||
      process.argv.length!==3)
    throw Error('Usage: node .github/scripts/admin-secure-pages.mjs --check|--apply|--check-site|--apply-site');
  const siteOnly=action.endsWith('-site');
  const state=inspect({siteOnly});
  console.log(JSON.stringify({scope:siteOnly?'PUBLIC_SITE_ONLY':'BOTH_REPOSITORIES',
    administrator:state.admin.login,
    reviewer:state.reviewer.login,
    repositories:state.repos.map(x=>({repo:x.repo,protected:x.branch.protected,
      ruleset:!!x.existing,head:x.branch.commit?.sha})),
    pages:state.pages.build_type,https:state.pages.https_enforced,
    environment:environmentMatches(state.env,state.reviewer.id)},null,2));
  if(action.startsWith('--check')){
    if(verified(state,{siteOnly})){
      console.log('PASS: admin gates');
    }else{
      console.error('NOT READY: admin gates absent; no settings changed');
      process.exitCode=2;
    }
    return;
  }
  if(process.env.ATTO_ADMIN_APPLY!=='YES')
    throw Error('Refusing mutation without ATTO_ADMIN_APPLY=YES');
  // Restrictive rulesets first; no bypass actors.
  for(const {repo,existing} of state.repos)
    if(!existing)api('POST','/repos/'+repo+'/rulesets',rulesetFor(repo));
  if(!environmentMatches(state.env,state.reviewer.id))
    api('PUT','/repos/'+REPOS[0]+'/environments/github-pages',
      environmentFor(state.reviewer.id));
  // Last: switch off the legacy branch-source automatic publisher.
  if(state.pages.build_type!=='workflow'||state.pages.https_enforced!==true)
    api('PUT','/repos/'+REPOS[0]+'/pages',{
      build_type:'workflow',https_enforced:true});
  if(!verified(inspect({siteOnly}),{siteOnly}))
    throw Error('E_ADMIN_POSTCHECK: hold merge and release');
  console.log(siteOnly?
    'PASS: PUBLIC Pages/main protected; PRIVATE compiler ruleset NOT VERIFIED; no deployment authorized':
    'PASS: protected main and reviewed Actions-only Pages; no deploy run');
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  try{main()}catch(e){console.error('ADMIN HOLD: '+e.message);process.exitCode=1}
}
