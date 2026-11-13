import test from 'node:test';
import assert from 'node:assert/strict';
import { checkReviewedRelease, verifyReleaseReviewEvidence } from './check-reviewed-release.mjs';

const HEAD='a'.repeat(40),PR_HEAD='b'.repeat(40);
function evidence() {
  const branch={name:'main',protected:true,commit:{sha:HEAD}};
  const pr={
    number:11,merged_at:'2026-11-07T00:00:00Z',merge_commit_sha:HEAD,
    base:{ref:'main'},head:{sha:PR_HEAD},user:{login:'the1mills'}
  };
  const approval={state:'APPROVED',commit_id:PR_HEAD,user:{login:'ORESoftware'}};
  return {headSha:HEAD,branch,pulls:[pr],reviewsByNumber:{11:[approval]}};
}
test('accepts exact main SHA, merged PR and independently approved exact PR head',()=>{
  assert.deepEqual(verifyReleaseReviewEvidence(evidence()),{
    release_sha:HEAD,pr_number:11,pr_head_sha:PR_HEAD
  });
});
test('a direct push with no merged PR never qualifies for release',()=>{
  const d=evidence();d.pulls=[];
  assert.throws(()=>verifyReleaseReviewEvidence(d),/Missing or incomplete PR ancestry/);
});
test('unprotected or stale main does not qualify even with review',()=>{
  const a=evidence();a.branch.protected=false;
  assert.throws(()=>verifyReleaseReviewEvidence(a),/not currently protected/);
  const b=evidence();b.branch.commit.sha='c'.repeat(40);
  assert.throws(()=>verifyReleaseReviewEvidence(b),/not currently protected/);
});
test('a PR author cannot self-approve a release',()=>{
  const d=evidence();d.reviewsByNumber[11]=[{state:'APPROVED',commit_id:PR_HEAD,user:{login:'the1mills'}}];
  assert.throws(()=>verifyReleaseReviewEvidence(d),/No independent/);
});
test('untrusted approver does not authorize public release',()=>{
  const d=evidence();d.reviewsByNumber[11]=[{state:'APPROVED',commit_id:PR_HEAD,user:{login:'random-user'}}];
  assert.throws(()=>verifyReleaseReviewEvidence(d),/No independent/);
});
test('stale PR-head approval cannot authorize a modified source tree',()=>{
  const d=evidence();d.reviewsByNumber[11][0].commit_id='d'.repeat(40);
  assert.throws(()=>verifyReleaseReviewEvidence(d),/No independent/);
});
test('dismissed review after approval revokes a previous approval',()=>{
  const d=evidence();
  d.reviewsByNumber[11].push({state:'DISMISSED',commit_id:PR_HEAD,user:{login:'ORESoftware'}});
  assert.throws(()=>verifyReleaseReviewEvidence(d),/No independent/);
});
test('unmerged, different-base and wrong-commit PRs all fail closed',()=>{
  for(const edit of [
    p => p.merged_at=null,
    p => p.base.ref='development',
    p => p.merge_commit_sha='c'.repeat(40)
  ]) {
    const d=evidence();edit(d.pulls[0]);
    assert.throws(()=>verifyReleaseReviewEvidence(d),/exactly one merged/);
  }
});
test('ambiguous merged PR associations and incomplete reviews fail closed',()=>{
  const a=evidence();a.pulls.push({...a.pulls[0],number:12});
  assert.throws(()=>verifyReleaseReviewEvidence(a),/exactly one merged/);
  const b=evidence();b.reviewsByNumber[11]=[];
  assert.throws(()=>verifyReleaseReviewEvidence(b),/incomplete independent review/);
});
test('authenticated read-only preflight retrieves exact main, PR and review',async()=>{
  const d=evidence(),urls=[];
  const f=async url=>{
    urls.push(url);
    const data=url.endsWith('/branches/main')?d.branch:
      url.includes('/commits/')?d.pulls:d.reviewsByNumber[11];
    return new Response(JSON.stringify(data),{status:200});
  };
  const got=await checkReviewedRelease({token:'test',headSha:HEAD,fetchImpl:f});
  assert.equal(got.release_sha,HEAD);
  assert.equal(urls.length,3);
  assert.ok(urls.every(u=>u.startsWith('https://api.github.com/repos/atto-lang/atto-lang.github.io/')));
});
test('missing permissions and paginated evidence are rejected',async()=>{
  const d=evidence();
  await assert.rejects(checkReviewedRelease({headSha:HEAD}),/Missing release API credential/);
  const denied=async()=>new Response('forbidden',{status:403});
  await assert.rejects(checkReviewedRelease({token:'x',headSha:HEAD,fetchImpl:denied}),/HTTP 403/);
  const paginated=async()=>new Response(JSON.stringify(d.branch),{
    status:200,headers:{link:'<https://api.github.com/test?page=2>; rel="next"'}
  });
  await assert.rejects(checkReviewedRelease({token:'x',headSha:HEAD,fetchImpl:paginated}),/Incomplete paginated/);
});

test('authenticated release review API cannot redirect credentials or follow cached evidence', async () => {
  const calls=[];
  const rejected=async (url,options)=>{
    calls.push({url,options});
    return {ok:true,status:200,redirected:true};
  };
  await assert.rejects(checkReviewedRelease({token:'test-token',headSha:HEAD,fetchImpl:rejected}),
    /redirected or invalid/);
  assert.equal(calls.length,1);
  assert.equal(calls[0].options.method,'GET');
  assert.equal(calls[0].options.redirect,'error');
  assert.equal(calls[0].options.cache,'no-store');
  assert.equal(calls[0].options.headers.Authorization,'Bearer test-token');
});
