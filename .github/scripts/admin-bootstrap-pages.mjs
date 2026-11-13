/**
 * AttoLang Pages administrator bootstrap. Execute manually with a GitHub
 * administrator's own authenticated `gh` session, never in a PR workflow.
 * Default is read-only verification. Use --apply --confirm REPO for mutation.
 * No compiler approval, PR review, merge or deployment is performed here.
 */
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = 'atto-lang/atto-lang.github.io';
export const RULESET_NAME = 'AttoLang protected main release';
export const REVIEWERS = Object.freeze(['ORESoftware', 'the1mills']);
export const APP_ID = 15368; // GitHub Actions, not a user-supplied check.
export const API = Object.freeze({
  pages: `repos/${REPO}/pages`,
  main: `repos/${REPO}/branches/main`,
  rulesets: `repos/${REPO}/rulesets`,
  active: `repos/${REPO}/rules/branches/main?per_page=100`,
  environment: `repos/${REPO}/environments/github-pages`
});

export function rulesetPayload() {
  return {
    name: RULESET_NAME, target: 'branch', enforcement: 'active',
    bypass_actors: [],
    conditions: { ref_name: { include: ['refs/heads/main'], exclude: [] } },
    rules: [
      { type: 'pull_request', parameters: {
        required_approving_review_count: 1,
        dismiss_stale_reviews_on_push: true,
        require_code_owner_review: true,
        require_last_push_approval: true,
        required_review_thread_resolution: true
      } },
      { type: 'required_status_checks', parameters: {
        strict_required_status_checks_policy: true,
        required_status_checks: [{ context: 'verify-public-artifact', integration_id: APP_ID }]
      } },
      { type: 'non_fast_forward' },
      { type: 'deletion' }
    ]
  };
}

export function environmentPayload(userIds) {
  if (!Array.isArray(userIds) || userIds.length !== 2 ||
      userIds.some(id => !Number.isSafeInteger(id) || id <= 0) ||
      userIds[0] === userIds[1]) {
    throw new Error('Two distinct positive GitHub user IDs are required');
  }
  return {
    prevent_self_review: true,
    can_admins_bypass: false,
    reviewers: userIds.map(id => ({ type: 'User', id })),
    deployment_branch_policy: { protected_branches: true, custom_branch_policies: false }
  };
}

export function verifyPages(pages) {
  if (pages?.build_type !== 'workflow' || pages.https_enforced !== true || pages.public !== true)
    throw new Error('Pages is not workflow-only, HTTPS-enforced and public');
  return true;
}

export function verifyBranch(branch) {
  if (branch?.name !== 'main' || branch.protected !== true ||
      !/^[0-9a-f]{40}$/.test(branch.commit?.sha ?? ''))
    throw new Error('main is not protected or has an invalid commit SHA');
  return branch.commit.sha;
}

export function verifyRules(rules) {
  if (!Array.isArray(rules)) throw new Error('Active main rules not accessible');
  const r = rulesetPayload().rules;
  for (const required of r) {
    const matches = rules.filter(rule => rule?.type === required.type);
    if (!matches.length) throw new Error('Active branch rule missing: ' + required.type);
    if (required.type === 'pull_request') {
      if (!matches.some(rule => Object.entries(required.parameters).every(([key,value]) =>
        rule.parameters?.[key] === value)))
        throw new Error('Effective independent PR code-owner review is insufficient');
    } else if (required.type === 'required_status_checks') {
      if (!matches.some(rule =>
        rule.parameters?.strict_required_status_checks_policy === true &&
        rule.parameters?.required_status_checks?.some(check =>
          check.context === 'verify-public-artifact' && check.integration_id === APP_ID)))
        throw new Error('GitHub Actions release status check is not strict/app-pinned');
    }
  }
  return true;
}

export function verifyRuleset(ruleset) {
  const expected = rulesetPayload();
  if (ruleset?.name !== RULESET_NAME || ruleset.target !== 'branch' ||
      ruleset.enforcement !== 'active' || !Array.isArray(ruleset.bypass_actors) ||
      ruleset.bypass_actors.length !== 0 ||
      !Array.isArray(ruleset.conditions?.ref_name?.include) ||
      !Array.isArray(ruleset.conditions?.ref_name?.exclude) ||
      ruleset.conditions.ref_name.include.length !== 1 ||
      ruleset.conditions.ref_name.include[0] !== 'refs/heads/main' ||
      ruleset.conditions.ref_name.exclude.length !== 0)
    throw new Error('Managed ruleset differs or has a bypass actor');
  if (!Array.isArray(ruleset.rules)) throw new Error('Managed rules not present');
  verifyRules(ruleset.rules);
  return true;
}

export function verifyEnvironment(environment, originalActor = '') {
  if (environment?.name !== 'github-pages' || environment.can_admins_bypass !== false ||
      environment.deployment_branch_policy?.protected_branches !== true ||
      environment.deployment_branch_policy?.custom_branch_policies !== false)
    throw new Error('github-pages environment is missing protected-branch/no-bypass restrictions');
  const rules = environment.protection_rules;
  const approvals = Array.isArray(rules) && rules.filter(rule => rule?.type === 'required_reviewers');
  if (!approvals || approvals.length !== 1 || approvals[0].prevent_self_review !== true)
    throw new Error('Environment lacks one required-reviewer rule preventing self-review');
  const actual = approvals[0].reviewers;
  const allowed = new Set(REVIEWERS.map(s => s.toLowerCase()));
  if (!Array.isArray(actual) || actual.length !== 2 || actual.some(r =>
    r.type !== 'User' || !allowed.has((r.reviewer?.login ?? '').toLowerCase())) ||
    new Set(actual.map(r => r.reviewer.login.toLowerCase())).size !== 2)
    throw new Error('Environment reviewer list differs from independently authorized accounts');
  if (originalActor && !actual.some(r => r.reviewer.login.toLowerCase() !== originalActor.toLowerCase()))
    throw new Error('No reviewer independent of bootstrap actor');
  return true;
}

// A privileged CLI must never write via an unattended CI worker, including
// providers that set CI=1/yes rather than CI=true. The presence of a nonempty
// marker is intentionally treated as CI even if its string value is "false".
export const CI_MARKERS = Object.freeze([
  'CI', 'GITHUB_ACTIONS', 'GITHUB_WORKFLOW', 'GITHUB_RUN_ID',
  'GITHUB_JOB', 'GITHUB_EVENT_PATH', 'RUNNER_OS',
  'GITLAB_CI', 'CIRCLECI', 'BUILDKITE'
]);
export function assertLocalAdminOnly(env=process.env) {
  if (CI_MARKERS.some(key => typeof env[key] === 'string' && env[key].length > 0))
    throw new Error('Refusing administrative mutation inside CI; use a trusted local terminal');
}

// Restrict the exported transport helper, not just the main CLI entrypoint:
// importing this module cannot make it a general-purpose privileged API proxy.
export function assertAllowedGitHubRequest(method, endpoint, env=process.env) {
  const readEndpoints = new Set([
    API.pages, API.main, API.rulesets, API.active, API.environment,
    ...REVIEWERS.map(login => 'users/' + login)
  ]);
  const detailPrefix = API.rulesets + '/';
  const isRulesetRead = typeof endpoint === 'string' &&
    endpoint.startsWith(detailPrefix) &&
    /^[1-9][0-9]*$/.test(endpoint.slice(detailPrefix.length));
  if (method === 'GET' && (readEndpoints.has(endpoint) || isRulesetRead)) return;
  const permittedWrite =
    (method === 'PUT' && (endpoint === API.pages || endpoint === API.environment)) ||
    (method === 'POST' && endpoint === API.rulesets);
  if (!permittedWrite) throw new Error('Refusing unexpected GitHub API method or endpoint');
  assertLocalAdminOnly(env);
}

/** Deliberately no HTTP client or token handling in this module; `gh` owns auth. */
export function ghApi(method, endpoint, body) {
  assertAllowedGitHubRequest(method, endpoint);
  const args = ['api', '--hostname', 'github.com', '--header', 'Accept: application/vnd.github+json',
    '--header', 'X-GitHub-Api-Version: 2022-11-28', '--method', method, endpoint];
  if (body !== undefined) args.push('--input', '-');
  const child = spawnSync('gh',args,{
    encoding:'utf8', input:body === undefined ? undefined : JSON.stringify(body),
    timeout:20000, maxBuffer:8*1024*1024,
    env:{...process.env,GH_PROMPT_DISABLED:'1'}
  });
  if (child.error || child.status !== 0) {
    // This optional read alone may be absent before environment creation.
    if (method === 'GET' && endpoint === API.environment &&
        /(?:HTTP\s*404|not found)/i.test(child.stderr ?? '')) return null;
    // Never echo stdout/stderr; it may include private metadata or credentials.
    throw new Error('GitHub API request failed: ' + method + ' ' + endpoint +
      '; check gh auth status, repository permission, or API response locally');
  }
  const output=(child.stdout || '').trim();
  if (!output) return null; // Some GitHub mutation endpoints return HTTP 204.
  try {return JSON.parse(output);}catch{throw new Error('Unexpected GitHub API JSON response');}
}

export function readState(api=ghApi) {
  const [pages,main,rulesets,environment,active] = [
    API.pages,API.main,API.rulesets,API.environment,API.active
  ].map(endpoint => api('GET',endpoint));
  if (!Array.isArray(rulesets)) throw new Error('Cannot inspect repository rulesets');
  return {pages,main,rulesets,environment,active};
}

export function verifyState(state, api=ghApi) {
  verifyPages(state.pages);
  const sha=verifyBranch(state.main);
  verifyRules(state.active);
  verifyEnvironment(state.environment);
  const matching=state.rulesets.filter(rule => rule.name === RULESET_NAME);
  if (matching.length !== 1 || !Number.isSafeInteger(matching[0].id))
    throw new Error('Expected exactly one active managed main ruleset');
  verifyRuleset(api('GET',API.rulesets+'/'+matching[0].id));
  return {status:'ADMIN_POLICY_VERIFIED',repo:REPO,main_head:sha,
    pages_mode:'workflow',environment:'github-pages',ruleset_id:matching[0].id,
    release_dispatched:false};
}

export function applySettings(api=ghApi) {
  // 1. Kill unsafe legacy branch-source publication first. Never create a
  // Pages site when one did not already exist (404 must fail closed).
  const originalPages=api('GET',API.pages);
  if (!originalPages || !['workflow','legacy'].includes(originalPages.build_type))
    throw new Error('Pages source cannot be determined; not modifying publication');
  if (originalPages.build_type !== 'workflow' || originalPages.https_enforced !== true)
    api('PUT', API.pages, {build_type:'workflow',https_enforced:true});
  verifyPages(api('GET',API.pages));

  // 2. Create, but never silently replace, an independent no-bypass ruleset.
  const current=api('GET',API.rulesets);
  if (!Array.isArray(current)) throw new Error('Cannot inspect rulesets');
  const ours=current.filter(item=>item.name===RULESET_NAME);
  if (ours.length>1) throw new Error('Duplicate managed rulesets; manual reconciliation required');
  if (ours.length===0) {
    api('POST',API.rulesets,rulesetPayload());
  } else {
    verifyRuleset(api('GET',API.rulesets+'/'+ours[0].id));
  }
  const branch=api('GET',API.main);
  verifyBranch(branch);
  verifyRules(api('GET',API.active));

  // 3. Configure reviewer identities from GitHub IDs, not invented literals.
  const ids=REVIEWERS.map(login=>{
    const user=api('GET','users/'+login);
    if (!Number.isSafeInteger(user?.id) || user.id<=0 ||
        user.login?.toLowerCase()!==login.toLowerCase())
      throw new Error('Cannot verify GitHub reviewer: '+login);
    return user.id;
  });
  const env=api('GET',API.environment);
  let alreadyProtected=false;
  try { verifyEnvironment(env); alreadyProtected=true; } catch { /* apply vetted payload */ }
  if (!alreadyProtected) api('PUT',API.environment,environmentPayload(ids));
  verifyEnvironment(api('GET',API.environment));
  return verifyState(readState(api),api);
}

function main(argv=process.argv.slice(2)) {
  if(argv.length===0 || argv.includes('--help')) {
    console.log('Usage: node admin-bootstrap-pages.mjs --verify | --apply --confirm '+REPO);
    console.log('Requires local gh CLI authenticated with Pages and Administration write permission.');
    console.log('Never run in CI; no merges, compiler approval, or deployments are performed.');
    return;
  }
  if(argv.length===1 && argv[0]==='--verify') {
    console.log(JSON.stringify(verifyState(readState()),null,2));return;
  }
  if(argv.length===3 && argv[0]==='--apply' && argv[1]==='--confirm' && argv[2]===REPO) {
    // Fail before even the read preflight on an unattended CI runner.
    assertLocalAdminOnly();
    console.log(JSON.stringify(applySettings(),null,2));return;
  }
  throw new Error('Refusing mutation: explicit --apply --confirm '+REPO+' required');
}
if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try { main(); } catch (e) { console.error('ADMIN_POLICY_NOT_VERIFIED: '+e.message);process.exitCode=1; }
}