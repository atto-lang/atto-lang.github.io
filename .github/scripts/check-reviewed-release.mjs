/** Read-only final release gate: no unreviewed branch push may be published.
 * This checks the exact public main SHA and the independently reviewed merged PR.
 * Branch protection and history-wide provenance remain separate administrator controls.
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = 'https://api.github.com/repos/atto-lang/atto-lang.github.io';
const HEX40 = /^[a-f0-9]{40}$/;
const TRUSTED = new Set(['oresoftware','the1mills']);

function requireObject(v,label) {
  if (!v || typeof v !== 'object' || Array.isArray(v))
    throw new Error('Missing or invalid '+label);
  return v;
}
export function verifyReleaseReviewEvidence({headSha,branch,pulls,reviewsByNumber}) {
  if (typeof headSha !== 'string' || !HEX40.test(headSha))
    throw new Error('Invalid release SHA');
  if (!requireObject(branch,'protected branch').protected ||
      branch.name !== 'main' || branch.commit?.sha !== headSha)
    throw new Error('Release main SHA is not currently protected and pinned');
  if (!Array.isArray(pulls) || pulls.length === 0 || pulls.length >= 100)
    throw new Error('Missing or incomplete PR ancestry proof for release SHA');
  const matching = pulls.filter(p =>
    p && p.merged_at && p.merge_commit_sha === headSha &&
    p.base?.ref === 'main' &&
    HEX40.test(p.head?.sha || '') &&
    Number.isSafeInteger(p.number) &&
    p.number > 0 && p.user?.login
  );
  if (matching.length !== 1)
    throw new Error('Release SHA must have exactly one merged main-branch PR');
  const pr = matching[0];
  const reviews = reviewsByNumber?.[pr.number];
  if (!Array.isArray(reviews) || reviews.length === 0 || reviews.length >= 100)
    throw new Error('Missing or incomplete independent review record');
  const latest = new Map();
  for (const review of reviews) {
    if (!review || typeof review !== 'object' || !review.user?.login)
      throw new Error('Malformed review record');
    const reviewer = review.user.login.toLowerCase();
    if (TRUSTED.has(reviewer) && reviewer !== pr.user.login.toLowerCase() &&
        ['APPROVED','DISMISSED','CHANGES_REQUESTED','COMMENTED'].includes(review.state))
      latest.set(reviewer,review);
  }
  const approved = [...latest.values()].some(r =>
    r.state === 'APPROVED' && r.commit_id === pr.head.sha);
  if (!approved)
    throw new Error('No independent trusted approval on exact merged PR head');
  return {release_sha:headSha,pr_number:pr.number,pr_head_sha:pr.head.sha};
}

export async function checkReviewedRelease({
  token, headSha, fetchImpl = fetch
} = {}) {
  if (!token || typeof token !== 'string') throw new Error('Missing release API credential');
  if (!HEX40.test(headSha || '')) throw new Error('Missing exact release SHA');
  async function get(path) {
    const response=await fetchImpl(API+path,{
      headers:{
        Accept:'application/vnd.github+json',
        Authorization:'Bearer '+token,
        'X-GitHub-Api-Version':'2022-11-28'
      },
      signal:AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new Error('Release review API check failed: '+path+' HTTP '+response.status);
    if (response.headers?.get?.('link')?.includes('rel="next"'))
      throw new Error('Incomplete paginated release review evidence');
    return response.json();
  }
  const branch=await get('/branches/main');
  const pulls=await get('/commits/'+headSha+'/pulls?per_page=100');
  if (!Array.isArray(pulls) || pulls.length !== 1 || !Number.isSafeInteger(pulls[0]?.number))
    throw new Error('Missing unique merged PR for requested release');
  const reviews=await get('/pulls/'+pulls[0].number+'/reviews?per_page=100');
  return verifyReleaseReviewEvidence({
    headSha,branch,pulls,reviewsByNumber:{[pulls[0].number]:reviews}
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.env.GITHUB_REPOSITORY !== 'atto-lang/atto-lang.github.io' ||
      process.env.GITHUB_REF !== 'refs/heads/main')
    throw new Error('Only an exact release on public main may proceed');
  const result=await checkReviewedRelease({
    token:process.env.GITHUB_TOKEN,headSha:process.env.GITHUB_SHA
  });
  console.log('PASS independently reviewed exact-release main commit',result);
}
