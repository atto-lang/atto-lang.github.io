// Release-time, fail-closed GitHub administration preflight.
// This verifies observable rules and environment state; it cannot grant
// approval, establish bypass invisibility, or authorize a private artifact.
const REPO='atto-lang/atto-lang.github.io';
const REQUIRED_CHECKS=['browser-and-guest','verify-public-artifact'];
const ACTIONS_APP_ID=15368;
const RELEASE_RULESET='atto-main-independent-review-v1';
const error=message=>new Error('E_RELEASE_GOVERNANCE: '+message);

export async function verifyReleaseGovernance({
  request=globalThis.fetch, token, repository=REPO,
  expectedHead=process.env.GITHUB_SHA
}={}) {
  if(repository!==REPO)throw error('Unexpected release repository');
  if(typeof token!=='string'||token.length<1)throw error('Missing read-only GitHub token');
  if(typeof expectedHead!=='string'||!/^[0-9a-f]{40}$/.test(expectedHead))
    throw error('Missing or malformed expected release head');
  async function get(path) {
    let response;
    try {
      response=await request('https://api.github.com/repos/'+repository+path,{
        method:'GET',
        redirect:'error',
        headers:{
          'Accept':'application/vnd.github+json',
          'X-GitHub-Api-Version':'2022-11-28',
          'Authorization':'Bearer '+token
        }
      });
    }catch{throw error('GitHub governance API inaccessible: '+path);}
    if(!response?.ok)throw error('GitHub governance API denied '+path+
      ' ('+String(response?.status||'unknown')+')');
    try{return await response.json();}
    catch{throw error('Malformed governance API JSON: '+path);}
  }

  const [branch,rules,pages,environment,listedRulesets]=await Promise.all([
    get('/branches/main'),
    get('/rules/branches/main?per_page=100'),
    get('/pages'),
    get('/environments/github-pages'),
    get('/rulesets?per_page=100')
  ]);
  if(branch?.name!=='main'||branch.protected!==true)
    throw error('main is not protected');
  if(branch.commit?.sha!==expectedHead)
    throw error('main head drifted from the checked-out release commit');
  if(!Array.isArray(rules)||rules.length>=100)
    throw error('Active main branch rules are unavailable or incomplete');
  const reviewed=rules.some(r=>r.type==='pull_request'&&
    r.parameters?.required_approving_review_count>=1&&
    r.parameters?.require_code_owner_review===true&&
    r.parameters?.require_last_push_approval===true&&
    r.parameters?.dismiss_stale_reviews_on_push===true);
  if(!reviewed)throw error('Require PR, CODEOWNERS, stale-review dismissal and last-push approval');
  const required=rules.filter(r=>r.type==='required_status_checks')
    .filter(r=>r.parameters?.strict_required_status_checks_policy===true)
    .flatMap(r=>r.parameters?.required_status_checks||[]);
  for(const context of REQUIRED_CHECKS)
    if(!required.some(x=>x.context===context&&x.integration_id===ACTIONS_APP_ID))
      throw error('Required exact CI check missing or untrusted GitHub Actions source: '+context);
  for(const type of ['deletion','non_fast_forward'])
    if(!rules.some(r=>r.type===type))throw error('Branch protection rule missing: '+type);
  // Effective branch rules do not expose any bypass actor privileges.
  // The release must depend on the exact independently reviewed no-bypass
  // ruleset, not a coincidentally strict-looking flattened rule collection.
  if(!Array.isArray(listedRulesets)||listedRulesets.length>=100)
    throw error('Named no-bypass main ruleset listing unavailable or incomplete');
  const named=listedRulesets.filter(x=>x?.name===RELEASE_RULESET);
  if(named.length!==1||!Number.isSafeInteger(named[0]?.id)||named[0].id<1)
    throw error('Exactly one named no-bypass main ruleset is required');
  const policy=await get('/rulesets/'+named[0].id);
  const refs=policy?.conditions?.ref_name;
  if(policy?.id!==named[0].id||policy.name!==RELEASE_RULESET||
      policy.target!=='branch'||policy.enforcement!=='active'||
      !Array.isArray(policy.bypass_actors)||policy.bypass_actors.length!==0||
      !Array.isArray(refs?.include)||refs.include.length!==1||
      refs.include[0]!=='refs/heads/main'||
      !Array.isArray(refs.exclude)||refs.exclude.length!==0)
    throw error('Named no-bypass main ruleset identity, scope or bypass policy invalid');
  if(!Array.isArray(policy.rules))
    throw error('Named no-bypass main ruleset rules unavailable');
  const ownerRule=policy.rules.find(x=>x.type==='pull_request')?.parameters;
  if(!(ownerRule?.required_approving_review_count>=1)||
      ownerRule.require_code_owner_review!==true||
      ownerRule.dismiss_stale_reviews_on_push!==true||
      ownerRule.require_last_push_approval!==true||
      ownerRule.required_review_thread_resolution!==true)
    throw error('Named no-bypass main ruleset missing independent review requirements');
  const statusRule=policy.rules.find(x=>x.type==='required_status_checks')?.parameters;
  if(statusRule?.strict_required_status_checks_policy!==true||
      !Array.isArray(statusRule.required_status_checks)||
      !REQUIRED_CHECKS.every(context=>statusRule.required_status_checks.some(
        x=>x.context===context&&x.integration_id===ACTIONS_APP_ID)))
    throw error('Named no-bypass main ruleset missing trusted strict CI requirements');
  if(!['deletion','non_fast_forward'].every(type=>
      policy.rules.some(x=>x.type===type)))
    throw error('Named no-bypass main ruleset missing immutable main protections');
  if(pages?.build_type!=='workflow'||pages.https_enforced!==true)
    throw error('GitHub Pages must use Actions-only publication and HTTPS');
  if(environment?.name!=='github-pages'||
      environment?.deployment_branch_policy?.protected_branches!==true)
    throw error('github-pages environment must allow protected branches only');
  const reviewer=environment.protection_rules?.find(r=>r.type==='required_reviewers'&&
    r.prevent_self_review===true&&
    r.reviewers?.some(entry=>entry.type==='User'&&
      entry.reviewer?.login?.toLowerCase()==='oresoftware'));
  if(!reviewer)throw error('Independent ORESoftware deployment review required');
  if(environment.can_admins_bypass!==false)
    throw error('github-pages must disallow administrator approval bypass');
  return Object.freeze({repository,branch:'main',checks:REQUIRED_CHECKS,
    pages_build:'workflow',environment:'github-pages',ruleset:RELEASE_RULESET});
}
if(process.argv[1]&&import.meta.url.endsWith('/'+process.argv[1].split('/').pop())){
  const result=await verifyReleaseGovernance({
    token:process.env.GITHUB_TOKEN,
    repository:process.env.GITHUB_REPOSITORY||REPO
  });
  console.log('PASS: live GitHub release governance verified for '+result.repository);
}
