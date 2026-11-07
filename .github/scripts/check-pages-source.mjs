/** GitHub Pages release-source enforcement. A manual release must be blocked
 * while Pages is configured to auto-build from a branch. This cannot itself
 * disable GitHub Pages legacy auto-publication; administration is required.
 */
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
export const PAGES_URL = 'https://api.github.com/repos/atto-lang/atto-lang.github.io/pages';
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
export async function checkPagesConfiguration({ token, fetchImpl = fetch } = {}) {
  if (typeof token !== 'string' || !token)
    throw new Error('Missing Pages read credential');
  const response = await fetchImpl(PAGES_URL, {
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': 'Bearer ' + token,
      'X-GitHub-Api-Version': '2022-11-28'
    },
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error('GitHub Pages settings unavailable (HTTP ' + response.status + ')');
  const site = await response.json();
  verifyPagesConfiguration(site);
  return { build_type: site.build_type, https_enforced: site.https_enforced };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.env.GITHUB_REPOSITORY !== 'atto-lang/atto-lang.github.io' ||
      process.env.GITHUB_REF !== 'refs/heads/main')
    throw new Error('Release must run on the exact public main branch');
  const status = await checkPagesConfiguration({token: process.env.GITHUB_TOKEN});
  console.log('PASS Pages publishing policy:', status.build_type, 'HTTPS enforced');
}
