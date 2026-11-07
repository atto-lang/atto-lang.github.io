/** A public Pages deploy must be protected by an independently reviewed,
 * non-bypassable environment. This reads settings; it does not create them.
 * The GitHub environment API is the source of truth; absent fields fail closed.
 */
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const ENVIRONMENT_URL =
  'https://api.github.com/repos/atto-lang/atto-lang.github.io/environments/github-pages';
const TRUSTED_REVIEWERS = new Set(['oresoftware', 'the1mills']);

export function verifyDeploymentEnvironment(environment, {requestActor, triggeringActor} = {}) {
  if (typeof requestActor !== 'string' || !/^[A-Za-z0-9-]{1,39}$/.test(requestActor) ||
      typeof triggeringActor !== 'string' || !/^[A-Za-z0-9-]{1,39}$/.test(triggeringActor))
    throw new Error('Blocked: original and rerun deployment actors are required');
  if (!environment || typeof environment !== 'object' || Array.isArray(environment) ||
      environment.name !== 'github-pages') {
    throw new Error('Blocked: github-pages environment missing or incorrect');
  }
  if (environment.can_admins_bypass !== false)
    throw new Error('Blocked: environment admin deployment bypass must be disabled');
  const branches = environment.deployment_branch_policy;
  if (!branches || branches.protected_branches !== true ||
      branches.custom_branch_policies !== false) {
    throw new Error('Blocked: environment must permit protected branches only');
  }
  const rules = environment.protection_rules;
  if (!Array.isArray(rules)) throw new Error('Blocked: deployment rules unavailable');
  const reviewerRules = rules.filter(rule => rule?.type === 'required_reviewers');
  if (reviewerRules.length !== 1)
    throw new Error('Blocked: exactly one required-reviewers protection rule is needed');
  const [approval] = reviewerRules;
  if (approval.prevent_self_review !== true)
    throw new Error('Blocked: environment must prevent deployment self-review');
  if (!Array.isArray(approval.reviewers) ||
      approval.reviewers.length < 1 || approval.reviewers.length > 6)
    throw new Error('Blocked: required reviewers absent or invalid');
  const names = [];
  for (const r of approval.reviewers) {
    const login = r?.reviewer?.login;
    if (r?.type !== 'User' || typeof login !== 'string' ||
        !TRUSTED_REVIEWERS.has(login.toLowerCase())) {
      throw new Error('Blocked: untrusted or unverified environment reviewer');
    }
    names.push(login.toLowerCase());
  }
  if (new Set(names).size !== names.length)
    throw new Error('Blocked: duplicate environment reviewer');
  const dispatchIdentities = new Set([requestActor.toLowerCase(), triggeringActor.toLowerCase()]);
  if (!names.some(name => !dispatchIdentities.has(name)))
    throw new Error('Blocked: no eligible independent deployment reviewer for this dispatch');
  return { environment: environment.name, protected_branches: true,
    prevent_self_review: true, admin_bypass_disabled: true, reviewers: names.length };
}

export async function checkDeploymentEnvironment({token, fetchImpl=fetch, requestActor, triggeringActor}={}) {
  if (typeof token !== 'string' || !token)
    throw new Error('Blocked: missing environment-read credential');
  const response = await fetchImpl(ENVIRONMENT_URL, {
    method: 'GET', redirect: 'error', cache: 'no-store',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: 'Bearer ' + token,
      'X-GitHub-Api-Version': '2022-11-28'
    },
    signal: AbortSignal.timeout(15000)
  });
  if (!response || response.redirected === true)
    throw new Error('Blocked: deployment environment API redirected');
  if (response.ok !== true)
    throw new Error('Blocked: deployment environment API unavailable (HTTP ' + response.status + ')');
  return verifyDeploymentEnvironment(await response.json(), {requestActor, triggeringActor});
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.env.GITHUB_REPOSITORY !== 'atto-lang/atto-lang.github.io' ||
      process.env.GITHUB_REF !== 'refs/heads/main' ||
      process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch') {
    throw new Error('Blocked: environment policy checks require manual main release');
  }
  const result = await checkDeploymentEnvironment({
    token: process.env.GITHUB_TOKEN,
    requestActor: process.env.GITHUB_ACTOR,
    triggeringActor: process.env.GITHUB_TRIGGERING_ACTOR
  });
  console.log('PASS independently protected github-pages environment:', JSON.stringify(result));
}
