/** GitHub Pages release-source enforcement. A manual release must be blocked
 * while Pages is configured to auto-build from a branch. This cannot itself
 * disable GitHub Pages legacy auto-publication; administration is required.
 */
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
export const PAGES_URL = 'https://api.github.com/repos/atto-lang/atto-lang.github.io/pages';
export const MAIN_URL = 'https://api.github.com/repos/atto-lang/atto-lang.github.io/branches/main';
export const RULES_URL = 'https://api.github.com/repos/atto-lang/atto-lang.github.io/rules/branches/main?per_page=100';
export function verifyPagesConfiguration(site) {
  if (!site || typeof site !== 'object' || Array.isArray(site))
    throw new Error('Missing GitHub Pages configuration');
  if (site.build_type !== 'workflow')
    throw new Error('Blocked: GitHub Pages is not workflow-source (legacy branch publication may bypass approval)');
  if (site.https_enforced !== true)
    throw new Error('Blocked: GitHub Pages HTTPS enforcement is not verified');
  if (site.public !== true)
    throw new Error('Blocked: expected public Pages site is not verified');
  return true;
}
/** A protected flag is necessary, not sufficient: require enforced CODEOWNERS,
 * independent approvals and required CI in GitHub's actual ruleset.
 * This preflight cannot administer those policies or validate approval quality.
 */
export function verifyMainProtection(branch, expectedSha) {
  if (!branch || typeof branch !== 'object' || Array.isArray(branch) ||
      branch.name !== 'main' || branch.protected !== true)
    throw new Error('Blocked: main branch protection is missing or unverifiable');
  if (typeof expectedSha !== 'string' || !/^[0-9a-f]{40}$/.test(expectedSha))
    throw new Error('Blocked: exact main commit SHA was not supplied');
  if (!branch.commit || branch.commit.sha !== expectedSha)
    throw new Error('Blocked: main advanced or the release checkout is not its current head');
  return true;
}

/** Only active, effective branch rules qualify. A generic protected flag alone
 * does not establish required code-owner approvals or executed CI. Ruleset
 * bypass actors are not exposed by this endpoint and still need admin review.
 */
export function verifyActiveMainRules(rules) {
  if (!Array.isArray(rules) || rules.length === 0)
    throw new Error('Blocked: active main-branch rules are missing');
  const pull = rules.find(rule => rule?.type === 'pull_request' &&
    rule.parameters?.require_code_owner_review === true &&
    rule.parameters?.dismiss_stale_reviews_on_push === true &&
    rule.parameters?.require_last_push_approval === true &&
    rule.parameters?.required_review_thread_resolution === true &&
    Number.isInteger(rule.parameters?.required_approving_review_count) &&
    rule.parameters.required_approving_review_count >= 1);
  if (!pull)
    throw new Error('Blocked: main lacks enforced independent code-owner PR review rules');
  const checks = rules.find(rule => rule?.type === 'required_status_checks' &&
    rule.parameters?.strict_required_status_checks_policy === true &&
    Array.isArray(rule.parameters?.required_status_checks) &&
    rule.parameters.required_status_checks.some(check =>
      check?.context === 'verify-public-artifact' &&
      Number.isSafeInteger(check.integration_id) && check.integration_id > 0));
  if (!checks)
    throw new Error('Blocked: main lacks strict required release-package CI checks');
  if (!rules.some(rule => rule?.type === 'non_fast_forward'))
    throw new Error('Blocked: main force-push prevention is not enforced');
  if (!rules.some(rule => rule?.type === 'deletion'))
    throw new Error('Blocked: main deletion prevention is not enforced');
  return true;
}

export async function checkPagesConfiguration({ token, fetchImpl = fetch, expectedSha } = {}) {
  if (typeof token !== 'string' || !token)
    throw new Error('Missing Pages read credential');
  const request = async (url, label) => {
    const response = await fetchImpl(url, {
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': 'Bearer ' + token,
        'X-GitHub-Api-Version': '2022-11-28'
      },
      // Never forward the credential through a redirect.
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(15000)
    });
    if (response.redirected) throw new Error(label + ' redirect is forbidden');
    if (!response.ok) throw new Error(label + ' unavailable (HTTP ' + response.status + ')');
    // The rules API is paged. Never certify a partial active-rule snapshot.
    if (url === RULES_URL && /rel="next"/.test(response.headers?.get?.('link') ?? ''))
      throw new Error('Blocked: active GitHub rules response is incomplete');
    return response.json();
  };
  const site = await request(PAGES_URL, 'GitHub Pages settings');
  verifyPagesConfiguration(site);
  const main = await request(MAIN_URL, 'GitHub main branch status');
  verifyMainProtection(main, expectedSha);
  const rules = await request(RULES_URL, 'Active main branch rules');
  verifyActiveMainRules(rules);
  return { build_type: site.build_type, https_enforced: site.https_enforced,
    main_protected: true, main_rules_verified: true };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.env.GITHUB_REPOSITORY !== 'atto-lang/atto-lang.github.io' ||
      process.env.GITHUB_REF !== 'refs/heads/main')
    throw new Error('Release must run on the exact public main branch');
  const status = await checkPagesConfiguration({token: process.env.GITHUB_TOKEN, expectedSha: process.env.GITHUB_SHA});
  console.log('PASS Pages publishing policy:', status.build_type, 'HTTPS enforced; protected main and active review/CI rules verified at release SHA');
}
