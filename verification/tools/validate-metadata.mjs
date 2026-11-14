/* Strict source-free advisory metadata validator; never certifies guest execution. */
const SHA=/^[a-f0-9]{40}$/i, DIGEST=/^sha256:[a-f0-9]{64}$/i, REPO=/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i, ID=/^[1-9][0-9]{0,18}$/;
const time=x=>typeof x==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(x)&&Number.isFinite(Date.parse(x));
const required=['backend','feature','repository','pr','head_sha','tree_sha','ci_repository','workflow_id','run_id','job_id','run_head_sha','run_attempt','job_run_attempt','run_status','run_conclusion','job_conclusion','runner','runner_os','runner_type','artifact_name','artifact_sha256','artifact_expires_at','contract_id','contract_version','contract_result','test_kind','test_result','review_state','reviewer','review_head_sha','pr_author','evidence_at','notes'];
const mirror=['mirror_repository','mirror_commit_sha','mirror_tree_sha'], allowed=new Set([...required,...mirror]);
export function validateMetadataSnapshot(d){
 const fail=m=>{throw Error('Invalid metadata snapshot: '+m)};
 if(!d||typeof d!=='object'||Array.isArray(d))fail('root');
 if(Object.keys(d).sort().join('|')!==['schema','mode','collected_at','release_certification','records'].sort().join('|'))fail('root keys');
 if(d.schema!=='attolang.metadata-snapshot.v1'||d.mode!=='read-only-source-free'||d.release_certification!=='NOT_CERTIFIED'||!time(d.collected_at))fail('root values');
 if(!Array.isArray(d.records)||d.records.length!==1)fail('one record');
 const r=d.records[0];if(!r||typeof r!=='object'||Array.isArray(r))fail('record');
 for(const k of required)if(typeof r[k]!=='string')fail('missing/typed '+k);
 for(const k of Object.keys(r))if(!allowed.has(k)||typeof r[k]!=='string')fail('unexpected '+k);
 if(!['Java/GraalVM','LLVM','Wasm','Forge/Cranelift','.NET'].includes(r.backend)||!r.feature||r.feature.length>80)fail('backend/feature');
 if(!REPO.test(r.repository)||!REPO.test(r.ci_repository)||!ID.test(r.pr))fail('repository or PR');
 for(const k of ['head_sha','tree_sha','run_head_sha'])if(!SHA.test(r[k]))fail('SHA '+k);
 for(const k of ['workflow_id','run_id','job_id','run_attempt','job_run_attempt'])if(!ID.test(r[k]))fail('ID '+k);
 if(r.run_attempt!==r.job_run_attempt||r.run_status!=='completed'||r.run_conclusion!=='success'||r.job_conclusion!=='success')fail('CI status');
 if(!/^[A-Za-z0-9_.-]{1,150}$/.test(r.artifact_name)||!DIGEST.test(r.artifact_sha256)||!time(r.artifact_expires_at))fail('artifact');
 if(!/^[A-Za-z0-9._:-]{1,120}$/.test(r.contract_id)||!/^[A-Za-z0-9._-]{1,60}$/.test(r.contract_version))fail('contract');
 if(r.contract_result!=='not_executed'||r.test_kind!=='none'||r.test_result!=='not_executed')fail('cannot promote guest execution');
 if(!['approved','pending'].includes(r.review_state)||!r.pr_author||r.pr_author.length>80||r.reviewer.length>80)fail('review state');
 if(r.review_state==='approved'&&(!r.reviewer||r.reviewer.toLowerCase()===r.pr_author.toLowerCase()||r.review_head_sha!==r.head_sha))fail('not independent');
 if(r.review_state==='pending'&&(r.reviewer||r.review_head_sha))fail('pending cannot approve');
 if(!time(r.evidence_at)||!r.notes||r.notes.length>400)fail('date/notes');
 if(mirror.some(k=>k in r)){
   if(mirror.some(k=>!Object.hasOwn(r,k)))fail('mirror triplet');
   if(!REPO.test(r.mirror_repository)||!SHA.test(r.mirror_commit_sha)||!SHA.test(r.mirror_tree_sha)||r.mirror_tree_sha!==r.tree_sha||r.ci_repository!==r.mirror_repository||r.run_head_sha!==r.mirror_commit_sha)fail('mirror binding');
 }else if(r.ci_repository!==r.repository||r.run_head_sha!==r.head_sha)fail('source binding');
 return d;
}
