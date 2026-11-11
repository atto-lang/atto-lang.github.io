// Release-time, fail-closed GitHub administration preflight.
// This verifies observable rules and environment state; it cannot grant
// approval, establish bypass invisibility, or authorize a private artifact.
const REPO='atto-lang/atto-lang.github.io';
const REQUIRED_CHECKS=['browser-and-guest','verify-public-artifact'];
const error=message=>new Error('E_RELEASE_GOVERNANCE: '+message);

export async function verifyReleaseGovernance({
  request=globalThis.fetch, token, repository=REPO
}={}) {
  if(repository!==REPO)throw error('Unexpected release repository');
  if(typeof token!=='string'||token.length<1)throw error('Missing read-only GitHub token');
  async function get(path) {
    let response;
    try {
      response=await request('https://api.github.com/repos/'+repository+path,{
        method:'GET',
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

  const [branch,rules,pages,environment]=await Promise.all([
    get('/branches/main'),
    get('/rules/branches/main?per_page=100'),
    get('/pages'),
    get('/environments/github-pages')
  ]);
  if(branch?.name!=='main'||branch.protected!==true)
    throw error('main is not protected');
  if(!Array.isArray(rules)||rules.length>=100)
    throw error('Active main branch rules are unavailable or incomplete');
  const reviewed=rules.some(r=>r.type==='pull_request'&&
    r.parameters?.required_approving_review_count>=1&&
    r.parameters?.require_code_owner_review===true&&
    r.parameters?.require_last_push_approval===true&&
    r.parameters?.dismiss_stale_reviews_on_push===true);
  if(!reviewed)throw error('Require PR, CODEOWNERS, stale-review dismissal and last-push approval');
  const checks=new Set(rules.filter(r=>r.type==='required_status_checks')
    .flatMap(r=>r.parameters?.required_status_checks||[])
    .map(x=>x.context));
  for(const c of REQUIRED_CHECKS)
    if(!checks.has(c))throw error('Required exact CI check missing: '+c);
  for(const type of ['deletion','non_fast_forward'])
    if(!rules.some(r=>r.type===type))throw error('Branch protection rule missing: '+type);
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
  return Object.freeze({repository,branch:'main',checks:REQUIRED_CHECKS,
    pages_build:'workflow',environment:'github-pages'});
}
if(process.argv[1]&&import.meta.url.endsWith('/'+process.argv[1].split('/').pop())){
  const result=await verifyReleaseGovernance({
    token:process.env.GITHUB_TOKEN,
    repository:process.env.GITHUB_REPOSITORY||REPO
  });
  console.log('PASS: live GitHub release governance verified for '+result.repository);
}
