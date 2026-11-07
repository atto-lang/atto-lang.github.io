#!/usr/bin/env node
/* Source-free private/public GitHub metadata collector: GET only.
 * Never downloads source, logs or artifacts. Output is NOT_EXECUTED / NOT_CERTIFIED.
 */
import {writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {validateMetadataSnapshot} from './validate-metadata.mjs';
const SHA=/^[a-f0-9]{40}$/i, REPO=/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i, DIGEST=/^sha256:[a-f0-9]{64}$/i;
const BACKENDS=['Java/GraalVM','LLVM','Wasm','Forge/Cranelift','.NET'];
const MAX_PAGES=30,MAX_AGE_MS=72*3600000;
const isTime=v=>typeof v==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(v)&&Number.isFinite(Date.parse(v));
const has=x=>x!==undefined&&x!==null&&String(x).length>0;
const fail=m=>{throw Error(m)};
function argsOf(argv){
 const o={};if(argv.length%2)fail('Expected flag/value pairs');
 for(let i=0;i<argv.length;i+=2){const k=argv[i];if(!/^--[a-z-]+$/.test(k)||!has(argv[i+1]))fail('Expected --flag value pairs');if(Object.hasOwn(o,k.slice(2)))fail('Duplicate option '+k);o[k.slice(2)]=argv[i+1];}
 const known=new Set(['repo','pr','backend','feature','workflow','run','job','artifact','contract','version','ci-repo','mirror-repo','mirror-commit','out']);
 for(const k of Object.keys(o))if(!known.has(k))fail('Unknown option '+k);
 for(const k of ['repo','pr','backend','feature','workflow','run','job','artifact','contract','version','out'])if(!has(o[k]))fail('Missing --'+k);
 for(const k of ['repo','ci-repo','mirror-repo'])if(has(o[k])&&!REPO.test(o[k]))fail('Invalid repository '+k);
 for(const k of ['pr','workflow','run','job'])if(!/^[1-9]\d{0,18}$/.test(o[k]))fail('Invalid positive numeric ID '+k);
 if(!BACKENDS.includes(o.backend))fail('Unsupported backend');
 if(!/^[A-Za-z0-9._:-]{1,120}$/.test(o.contract)||!/^[A-Za-z0-9._-]{1,60}$/.test(o.version))fail('Invalid contract');
 if(!/^[a-zA-Z0-9_.-]{1,150}$/.test(o.artifact)||o.feature.length>80||/[<>\r\n]/.test(o.feature))fail('Invalid artifact/feature');
 if(has(o['mirror-repo'])!==has(o['mirror-commit']))fail('Mirror repo and commit must both be supplied');
 if(has(o['mirror-commit'])&&!SHA.test(o['mirror-commit']))fail('Invalid mirror commit');
 if(has(o['mirror-repo'])&&o['ci-repo']!==o['mirror-repo'])fail('CI repository must match mirror');
 if(o.out==='-'||!o.out.endsWith('.json'))fail('Use explicit local --out file.json; stdout export forbidden');
 return o;
}
export async function collect(options,{fetchFn=fetch,token=process.env.GITHUB_TOKEN||'',clock=()=>new Date()}={}){
 const cfg=argsOf(Object.entries(options).flatMap(([k,v])=>['--'+k,String(v)]));
 const headers={Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'};
 if(token)headers.Authorization='Bearer '+token;
 const get=async path=>{
  if(!/^\/repos\/[a-z0-9_.-]+\/[a-z0-9_.-]+\/(?:pulls\/\d+(?:\/reviews\?per_page=100&page=\d+)?|git\/commits\/[a-f0-9]{40}|actions\/(?:runs\/\d+(?:\/artifacts\?per_page=100&page=\d+)?|jobs\/\d+))$/i.test(path))fail('Read-only endpoint not allowed');
  const response=await fetchFn('https://api.github.com'+path,{method:'GET',headers,redirect:'error',credentials:'omit',cache:'no-store'});
  if(!response.ok)fail('GitHub metadata GET failed: HTTP '+response.status);
  const size=Number(response.headers?.get?.('content-length')||0);if(size>5e6)fail('Metadata response too large');
  const body=await response.text();if(body.length>5e6)fail('Metadata response too large');
  return JSON.parse(body);
 };
 const source='/repos/'+cfg.repo,ci='/repos/'+(cfg['ci-repo']||cfg.repo);
 const pr=await get(source+'/pulls/'+cfg.pr),head=pr.head?.sha,author=pr.user?.login||'';
 if(!SHA.test(head||'')||!author)fail('Missing PR head or author');
 const sourceCommit=await get(source+'/git/commits/'+head),tree=sourceCommit.tree?.sha;
 if(!SHA.test(tree||''))fail('Source commit tree missing');
 const mirrored=has(cfg['mirror-commit']);let mirrorTree='';
 if(mirrored){
  const mc=await get('/repos/'+cfg['mirror-repo']+'/git/commits/'+cfg['mirror-commit']);
  mirrorTree=mc.tree?.sha||'';if(mirrorTree!==tree)fail('Mirror Git tree mismatch');
 }else if(cfg['ci-repo']&&cfg['ci-repo']!==cfg.repo)fail('Cross-repository CI needs mirror binding');
 const run=await get(ci+'/actions/runs/'+cfg.run),job=await get(ci+'/actions/jobs/'+cfg.job);
 if(String(run.workflow_id)!==cfg.workflow||String(run.id)!==cfg.run||String(job.run_id)!==cfg.run||String(job.id)!==cfg.job)fail('Workflow/run/job identity mismatch');
 if(run.head_sha!==(mirrored?cfg['mirror-commit']:head))fail('Run head mismatches pinned commit');
 if(!Number.isSafeInteger(run.run_attempt)||run.run_attempt<1||String(job.run_attempt)!==String(run.run_attempt))fail('CI attempt mismatch');
 if(run.status!=='completed'||run.conclusion!=='success'||job.conclusion!=='success')fail('CI run/job not successful');
 if(run.repository?.full_name!==(cfg['ci-repo']||cfg.repo))fail('CI repository mismatch');
 if(!job.runner_name||!Array.isArray(job.labels)||!job.labels.some(x=>/ubuntu|linux|windows|macos/i.test(x)))fail('Runner provenance missing');
 const now=clock().getTime();
 if(!isTime(run.updated_at)||Date.parse(run.updated_at)>now+300000||now-Date.parse(run.updated_at)>MAX_AGE_MS)fail('CI run evidence missing or stale');
 const approvals=[];
 for(let page=1;page<=MAX_PAGES;page++){
  const arr=await get(source+'/pulls/'+cfg.pr+'/reviews?per_page=100&page='+page);
  if(!Array.isArray(arr)||arr.length>100)fail('Review pagination malformed');
  approvals.push(...arr);if(arr.length<100)break;if(page===MAX_PAGES)fail('Review pagination exceeds maximum');
 }
 const latest=new Map();
 for(const review of approvals){const login=review.user?.login?.toLowerCase();if(login)latest.set(login,review);}
 const independent=[...latest.values()].find(r=>r.state==='APPROVED'&&r.user.login.toLowerCase()!==author.toLowerCase()&&r.commit_id===head);
 const artifacts=[];let total=null;
 for(let page=1;page<=MAX_PAGES;page++){
  const d=await get(ci+'/actions/runs/'+cfg.run+'/artifacts?per_page=100&page='+page);
  if(!Array.isArray(d.artifacts)||!Number.isSafeInteger(d.total_count)||d.total_count<0||d.artifacts.length>100)fail('Artifact pagination malformed');
  if(total===null){total=d.total_count;if(total>MAX_PAGES*100)fail('Too many artifacts');}
  else if(total!==d.total_count)fail('Artifact count changed during collection');
  artifacts.push(...d.artifacts);
  if(artifacts.length>total)fail('Artifact pagination overcount');
  if(artifacts.length===total)break;
  if(d.artifacts.length!==100||page===MAX_PAGES)fail('Artifact pagination incomplete');
 }
 const matches=artifacts.filter(a=>a.name===cfg.artifact&&!a.expired);
 if(matches.length!==1||!DIGEST.test(matches[0].digest||''))fail('Exactly one unexpired SHA-256 artifact required');
 const artifact=matches[0];
 if(!isTime(artifact.expires_at)||Date.parse(artifact.expires_at)<=now)fail('Artifact expiry missing or elapsed');
 if(!artifact.workflow_run||String(artifact.workflow_run.id)!==cfg.run)fail('Artifact run binding missing/mismatched');
 const endRun=await get(ci+'/actions/runs/'+cfg.run);
 if(String(endRun.id)!==cfg.run||String(endRun.workflow_id)!==cfg.workflow||endRun.head_sha!==run.head_sha||String(endRun.run_attempt)!==String(run.run_attempt)||endRun.status!=='completed'||endRun.conclusion!=='success')fail('CI run changed during collection');
 const endPr=await get(source+'/pulls/'+cfg.pr);
 if(endPr.head?.sha!==head)fail('PR head moved during collection');
 const at=clock().toISOString();
 const record={
  backend:cfg.backend,feature:cfg.feature,repository:cfg.repo,pr:cfg.pr,head_sha:head,tree_sha:tree,ci_repository:cfg['ci-repo']||cfg.repo,
  ...(mirrored?{mirror_repository:cfg['mirror-repo'],mirror_commit_sha:cfg['mirror-commit'],mirror_tree_sha:mirrorTree}:{}),
  workflow_id:cfg.workflow,run_id:cfg.run,job_id:cfg.job,run_head_sha:run.head_sha,run_attempt:String(run.run_attempt),job_run_attempt:String(job.run_attempt),
  run_status:run.status,run_conclusion:run.conclusion,job_conclusion:job.conclusion,
  runner:job.runner_name,runner_os:job.labels.find(x=>/ubuntu|linux|windows|macos/i.test(x))||'',runner_type:'',
  artifact_name:cfg.artifact,artifact_sha256:artifact.digest,artifact_expires_at:artifact.expires_at,
  contract_id:cfg.contract,contract_version:cfg.version,contract_result:'not_executed',test_kind:'none',test_result:'not_executed',
  review_state:independent?'approved':'pending',reviewer:independent?.user?.login||'',
  review_head_sha:independent?.commit_id||'',pr_author:author,evidence_at:run.updated_at,
  notes:'GitHub metadata only: no artifact download, no guest or release attestation.'
 };
 return validateMetadataSnapshot({schema:'attolang.metadata-snapshot.v1',mode:'read-only-source-free',collected_at:at,release_certification:'NOT_CERTIFIED',records:[record]});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const cfg=argsOf(process.argv.slice(2)),result=await collect(cfg);
  await writeFile(cfg.out,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
  process.stderr.write('Wrote local untrusted metadata snapshot; NOT_CERTIFIED.\n');
 }catch(e){process.stderr.write('Fail closed: '+e.message+'\n');process.exitCode=1;}
}
