// Local JSON import schema. Validated data remains an UNVERIFIED claim.
export function validateReceipt(v){
 if(!v||typeof v!=='object'||Array.isArray(v))throw Error('Expected a JSON object.');
 if(!['browser-rust','wasm','rs','js','release'].includes(v.artifact_id))throw Error('Unknown artifact_id.');
 if(!['browser','node','native','deployment'].includes(v.environment))throw Error('Invalid environment.');
 for(const k of ['repo_sha','compiler_sha','runtime_sha'])if(!/^[a-f0-9]{40}$/i.test(String(v[k]||'')))throw Error(`Missing or invalid ${k}: exact 40-character commit SHA required.`);
 if(!/^[a-f0-9]{64}$/i.test(String(v.asset_sha256||'')))throw Error('Missing or invalid asset_sha256 (64 hex characters).');
 if(typeof v.run_id!=='string'||v.run_id.length<1||v.run_id.length>128)throw Error('Required run_id is missing or too long.');
 if(!Number.isSafeInteger(v.attempt)||v.attempt<1)throw Error('attempt must be a positive integer.');
 if(!Number.isSafeInteger(v.steps_executed)||v.steps_executed<0)throw Error('steps_executed must be a nonnegative integer.');
 if(!['pass','fail','not_executed'].includes(v.result))throw Error('result must be pass, fail, or not_executed.');
 if(!Array.isArray(v.test_ids)||!v.test_ids.every(t=>typeof t==='string'&&t.length<=120)||v.test_ids.length>200)throw Error('test_ids must be a bounded array of strings.');
 if(typeof v.observed_at!=='string'||!Number.isFinite(Date.parse(v.observed_at)))throw Error('observed_at must be an ISO-like date string.');
 if(v.steps_executed===0&&v.result==='pass')throw Error('Zero executed steps cannot support a pass claim.');
 const clean={artifact_id:v.artifact_id,environment:v.environment,repo_sha:v.repo_sha,compiler_sha:v.compiler_sha,runtime_sha:v.runtime_sha,asset_sha256:v.asset_sha256,run_id:v.run_id,attempt:v.attempt,steps_executed:v.steps_executed,result:v.result,test_ids:v.test_ids.slice(),observed_at:v.observed_at,claim_status:'UNVERIFIED_IMPORT'};
 if(v.guest_sha256){if(!/^[a-f0-9]{64}$/i.test(String(v.guest_sha256)))throw Error('Invalid guest_sha256.');clean.guest_sha256=v.guest_sha256;}
 return clean;
}
