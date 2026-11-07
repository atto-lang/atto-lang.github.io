import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {generateKeyPairSync,sign} from 'node:crypto';
import {verifySignedGuestReceipt,canonicalPayload,signingBytes,DOMAIN,verifyFiveBackendSignedParity} from '../tools/verify-signed-guest-receipt.mjs';

const H=x=>x.repeat(40),D=x=>'sha256:'+x.repeat(64);
const now=new Date('2026-11-07T18:00:00.000Z');
const iso=offset=>new Date(now.getTime()+offset).toISOString();
const hour=3600000;
const {publicKey,privateKey}=generateKeyPairSync('ed25519');
const publicPEM=publicKey.export({type:'spki',format:'pem'});
const BINDINGS=['backend','feature','repository','pr','head_sha','tree_sha','ci_repository','mirror_repository','mirror_commit_sha','mirror_tree_sha','workflow_id','run_id','job_id','run_head_sha','run_attempt','job_run_attempt','runner','runner_os','artifact_name','artifact_sha256','contract_id','contract_version'];
function fixture(){
  const r={backend:'LLVM',feature:'Checked arithmetic',repository:'example-org/compiler',pr:'42',head_sha:H('a'),tree_sha:H('b'),ci_repository:'example-org/compiler',workflow_id:'11',run_id:'22',job_id:'33',run_head_sha:H('a'),run_attempt:'1',job_run_attempt:'1',run_status:'completed',run_conclusion:'success',job_conclusion:'success',runner:'runner-host-11',runner_os:'ubuntu-24.04',runner_type:'',artifact_name:'signed-guest-evidence',artifact_sha256:D('c'),artifact_expires_at:iso(10*hour),contract_id:'checked-i64',contract_version:'v1',contract_result:'not_executed',test_kind:'none',test_result:'not_executed',review_state:'approved',reviewer:'independent',review_head_sha:H('a'),pr_author:'author',evidence_at:iso(-hour),notes:'Read-only GitHub metadata; not actual guest execution.'};
  const metadata={schema:'attolang.metadata-snapshot.v1',mode:'read-only-source-free',collected_at:iso(-hour/2),release_certification:'NOT_CERTIFIED',records:[r]};
  const payload=Object.fromEntries(BINDINGS.map(k=>[k,r[k]||'']));
  Object.assign(payload,{receipt_id:'1'.repeat(32),nonce:'2'.repeat(64),issued_at:iso(-hour/4),expires_at:iso(2*hour),guest_execution_mode:'native-aot',guest_runtime_id:'verified-llvm-guest',guest_binary_sha256:D('d'),execution_log_sha256:D('e'),guest_result_sha256:D('f'),executed_cases:'26',test_kind:'guest',test_result:'passed',contract_result:'passed'});
  const envelope={schema:'attolang.signed-guest-receipt.v1',algorithm:'Ed25519',key_id:'trusted-guest-2026',payload,signature:''};
  const trust={schema:'attolang.guest-trust-policy.v1',challenge_nonce:'2'.repeat(64),revoked_receipt_ids:[],seen_receipt_ids:[],keys:[{key_id:'trusted-guest-2026',role:'guest-execution-attestor',attestor_login:'trusted-attestor',public_key_pem:publicPEM,not_before:iso(-24*hour),not_after:iso(24*hour),revoked:false,allowed_repositories:[r.repository],allowed_backends:[r.backend],allowed_contracts:[r.contract_id]}]};
  const x={metadata,envelope,trust,now};resign(x);return x;
}
function resign(x){x.envelope.signature=sign(null,signingBytes(x.envelope.payload),privateKey).toString('base64');return x;}
const verifies=x=>verifySignedGuestReceipt(x);
const reject=(change,pattern)=>{const x=fixture();change(x);assert.throws(()=>verifies(x),pattern||/Signed guest receipt rejected|Invalid metadata snapshot/);};
test('valid cryptographic guest attestation remains advisory and NOT_CERTIFIED',()=>{
  const v=verifies(fixture());assert.equal(v.status,'SIGNED_GUEST_ATTESTATION_VERIFIED');assert.equal(v.release_certification,'NOT_CERTIFIED');assert.equal(v.merge_readiness,'ADVISORY_ONLY');assert.equal(v.executed_cases,'26');
});
test('canonical bytes are deterministic and domain-separated',()=>{
  const {envelope:{payload}}=fixture();const reordered=Object.fromEntries(Object.entries(payload).reverse());
  assert.equal(canonicalPayload(reordered),canonicalPayload(payload));assert.equal(signingBytes(payload).toString('utf8'),DOMAIN+canonicalPayload(payload));
});
test('versioned contract JSON Schemas are strict and require intended identity fields',()=>{
 for(const file of ['signed-guest-receipt.v1.schema.json','guest-trust-policy.v1.schema.json']){
  const schema=JSON.parse(readFileSync(new URL('../schemas/'+file,import.meta.url),'utf8'));
  assert.equal(schema.additionalProperties,false);assert.ok(schema.required.length>=5);
 }
 const schema=JSON.parse(readFileSync(new URL('../schemas/signed-guest-receipt.v1.schema.json',import.meta.url),'utf8'));
 assert.equal(schema.properties.payload.additionalProperties,false);assert.ok(schema.properties.payload.required.includes('execution_log_sha256'));
});
test('untrusted unsigned, wrong algorithm, and wrong schema fail',()=>{
 reject(x=>x.envelope.signature='',/signature encoding/);
 reject(x=>x.envelope.algorithm='HS256',/schema\/algorithm/);
 reject(x=>x.envelope.schema='attolang.signed-guest-receipt.v2',/schema\/algorithm/);
});
test('signature cannot be forged by changing status, cases, binary or results',()=>{
 for(const [k,v] of [['executed_cases','27'],['guest_binary_sha256',D('a')],['execution_log_sha256',D('a')],['guest_result_sha256',D('a')],['guest_runtime_id','other']])reject(x=>x.envelope.payload[k]=v,/signature invalid/);
});
test('signature cannot be silently replaced with noncanonical base64',()=>{
 reject(x=>x.envelope.signature=x.envelope.signature.replace(/.$/,'a'),/signature encoding|noncanonical/);
 reject(x=>x.envelope.signature='0'.repeat(88),/signature encoding/);
});
test('correct signature from an unauthorized key is rejected',()=>{
 const {privateKey:other}=generateKeyPairSync('ed25519');
 reject(x=>x.envelope.signature=sign(null,signingBytes(x.envelope.payload),other).toString('base64'),/signature invalid/);
});
test('unknown key, revoked key and duplicate trust IDs fail',()=>{
 reject(x=>x.envelope.key_id='other-key',/key missing/);
 reject(x=>x.trust.keys[0].revoked=true,/key missing\/revoked/);
 reject(x=>x.trust.keys.push({...x.trust.keys[0]}),/duplicate/);
});
test('trust scope is restricted to declared backend, repository and contract',()=>{
 reject(x=>x.trust.keys[0].allowed_repositories=['different-org/compiler'],/outside authorized scope/);
 reject(x=>x.trust.keys[0].allowed_backends=['Wasm'],/outside authorized scope/);
 reject(x=>x.trust.keys[0].allowed_contracts=['not-the-contract'],/outside authorized scope/);
});
test('wrong role, wrong key type and expired or future key fail',()=>{
 reject(x=>x.trust.keys[0].role='release-certifier',/role/);
 reject(x=>x.trust.keys[0].attestor_login='author',/attestor must be independent/);
 reject(x=>x.trust.keys[0].not_after=iso(-hour),/expired/);
 reject(x=>x.trust.keys[0].not_before=iso(hour),/expired/);
 const {publicKey:rsa}=generateKeyPairSync('rsa',{modulusLength:2048});
 reject(x=>x.trust.keys[0].public_key_pem=rsa.export({type:'spki',format:'pem'}),/public key invalid|not Ed25519/);
});
test('challenge nonce mismatch and replayed or revoked receipts fail',()=>{
 reject(x=>x.trust.challenge_nonce='4'.repeat(64),/challenge nonce/);
 reject(x=>x.trust.seen_receipt_ids.push('1'.repeat(32)),/revoked or replayed/);
 reject(x=>x.trust.revoked_receipt_ids.push('1'.repeat(32)),/revoked or replayed/);
});
test('expired, future and overlong receipts fail',()=>{
 reject(x=>{x.envelope.payload.expires_at=iso(-hour);resign(x)},/expired or overlong/);
 reject(x=>{x.envelope.payload.issued_at=iso(hour);resign(x)},/future/);
 reject(x=>{x.envelope.payload.expires_at=iso(48*hour);resign(x)},/expired or overlong/);
});
test('expired CI artifact, stale metadata and stale run evidence fail',()=>{
 reject(x=>x.metadata.records[0].artifact_expires_at=iso(-hour),/artifact expired/);
 reject(x=>x.metadata.collected_at=iso(-73*hour),/snapshot stale/);
 reject(x=>x.metadata.records[0].evidence_at=iso(-73*hour),/CI metadata stale/);
});
test('exact SHA, run, attempt, artifact and conformance bindings are mandatory',()=>{
 for(const [k,v] of [['head_sha',H('f')],['tree_sha',H('f')],['run_head_sha',H('f')],['run_attempt','2'],['job_run_attempt','2'],['workflow_id','77'],['run_id','77'],['job_id','77'],['artifact_sha256',D('a')],['contract_version','v2']]){
  reject(x=>{x.envelope.payload[k]=v;resign(x)},/exact evidence mismatch/);
 }
});
test('mirror tree, mirror commit and mirror CI identity are bound together',()=>{
 const x=fixture();const r=x.metadata.records[0];Object.assign(r,{ci_repository:'example-org/mirror',mirror_repository:'example-org/mirror',mirror_commit_sha:H('c'),mirror_tree_sha:H('b'),run_head_sha:H('c')});
 for(const k of BINDINGS)x.envelope.payload[k]=r[k]||'';
 resign(x);assert.equal(verifies(x).status,'SIGNED_GUEST_ATTESTATION_VERIFIED');
 x.envelope.payload.mirror_tree_sha=H('f');resign(x);assert.throws(()=>verifies(x),/exact evidence mismatch/);
});
test('self review, review on old head and pending review deny verification',()=>{
 reject(x=>x.metadata.records[0].reviewer='author',/metadata snapshot|independent/);
 reject(x=>x.metadata.records[0].review_head_sha=H('f'),/metadata snapshot|independent/);
 reject(x=>Object.assign(x.metadata.records[0],{review_state:'pending',reviewer:'',review_head_sha:''}),/independent current-head/);
});
test('host-only, parser-only and failed guest attempts cannot be elevated by signature',()=>{
 for(const [k,v] of [['test_kind','host'],['test_kind','parser'],['test_result','failed'],['contract_result','failed']]){
  reject(x=>{x.envelope.payload[k]=v;resign(x)},/executed passing guest/);
 }
});
test('invalid counts, absent digests, unknown payload fields and extra privileged claims fail',()=>{
 reject(x=>{x.envelope.payload.executed_cases='0';resign(x)},/count|ID/);
 reject(x=>{x.envelope.payload.guest_binary_sha256='';resign(x)},/digest/);
 reject(x=>{x.envelope.payload.release_certified=true;},/payload fields/);
 reject(x=>{x.trust.keys[0].private_key_pem='secret';},/trusted key fields/);
});
test('invalid trust root cannot authenticate the issuer',()=>{
 reject(x=>{x.trust.keys=[];},/trust keys/);
 reject(x=>{x.trust.challenge_nonce='';},/challenge/);
 reject(x=>{x.trust.keys[0].public_key_pem='garbage';},/public key/);
});
test('source-free verifier has no network operations and does not sign in production',()=>{
 const src=readFileSync(new URL('../tools/verify-signed-guest-receipt.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(src,/\bfetch\(|https\.request\(|\bcreatePrivateKey\(|\bexec\(|\bspawn\(/);
 assert.doesNotMatch(src,/process\.env\.GITHUB_TOKEN/);
 assert.ok(src.includes("release_certification:'NOT_CERTIFIED'"));
});
test('CLI returns advisory verdict and fails closed on tampering',()=>{
 const dir=mkdtempSync(join(tmpdir(),'atto-signed-receipt-'));
 const x=fixture();
 for(const [key,val] of [['receipt',x.envelope],['metadata',x.metadata],['trust',x.trust]])writeFileSync(join(dir,key+'.json'),JSON.stringify(val));
 const cli=new URL('../tools/verify-signed-guest-receipt.mjs',import.meta.url).pathname;
 const args=['--receipt',join(dir,'receipt.json'),'--metadata',join(dir,'metadata.json'),'--trust',join(dir,'trust.json')];
 const good=spawnSync(process.execPath,[cli,...args],{encoding:'utf8'});
 assert.equal(good.status,0,good.stderr);assert.equal(JSON.parse(good.stdout).release_certification,'NOT_CERTIFIED');
 x.envelope.payload.contract_version='malicious';writeFileSync(join(dir,'receipt.json'),JSON.stringify(x.envelope));
 const bad=spawnSync(process.execPath,[cli,...args],{encoding:'utf8'});assert.equal(bad.status,1);assert.match(bad.stderr,/NOT_CERTIFIED/);assert.equal(bad.stdout,'');
});

test('all five independently verified signed backend claims can align without release certification',()=>{
 const names=['Java/GraalVM','LLVM','Wasm','Forge/Cranelift','.NET'];
 const batch=names.map((backend,i)=>{
   const x=fixture();x.metadata.records[0].backend=backend;
   x.envelope.payload.backend=backend;
   x.envelope.payload.receipt_id=String(i+1).repeat(32);
   x.trust.keys[0].allowed_backends=names;
   resign(x);return x;
 });
 const result=verifyFiveBackendSignedParity(batch,{now});
 assert.equal(result.status,'FIVE_BACKEND_SIGNED_ATTESTATIONS_ALIGNED');
 assert.equal(result.release_certification,'NOT_CERTIFIED');
 assert.deepEqual(result.missing_backends,[]);
 const incomplete=verifyFiveBackendSignedParity(batch.slice(0,3),{now});
 assert.equal(incomplete.status,'INCOMPLETE_SIGNED_GUEST_ATTESTATIONS');
 assert.equal(incomplete.missing_backends.length,2);
});
test('five-backend aggregation fails closed on duplicate, mismatched contract and invalid signature',()=>{
 const names=['Java/GraalVM','LLVM','Wasm','Forge/Cranelift','.NET'];
 const batch=names.map((backend,i)=>{
  const x=fixture();x.metadata.records[0].backend=backend;
  x.envelope.payload.backend=backend;
  x.envelope.payload.receipt_id=String(i+1).repeat(32);
  x.trust.keys[0].allowed_backends=names;resign(x);return x;
 });
 assert.throws(()=>verifyFiveBackendSignedParity([...batch.slice(0,4),batch[0]],{now}),/duplicate/);
 batch[3].metadata.records[0].contract_version='v2';batch[3].envelope.payload.contract_version='v2';resign(batch[3]);
 assert.throws(()=>verifyFiveBackendSignedParity(batch,{now}),/contract\/feature version mismatch/);
 batch[3].metadata.records[0].contract_version='v1';batch[3].envelope.payload.contract_version='v1';resign(batch[3]);
 batch[4].envelope.payload.guest_runtime_id='forged';
 assert.throws(()=>verifyFiveBackendSignedParity(batch,{now}),/signature invalid/);
});
test('key rotation accepts an authorized replacement, refuses revoked old key and preserves release denial',()=>{
 const x=fixture();
 const old={...x.trust.keys[0],revoked:true};
 const next={...old,key_id:'trusted-guest-2027',revoked:false,not_before:iso(-hour),not_after:iso(24*hour)};
 x.trust.keys=[old,next];x.envelope.key_id=next.key_id;
 const verdict=verifies(x);assert.equal(verdict.key_id,'trusted-guest-2027');assert.equal(verdict.release_certification,'NOT_CERTIFIED');
 x.envelope.key_id=old.key_id;assert.throws(()=>verifies(x),/key missing\/revoked/);
});
test('a valid signature cannot bypass mismatched runner, job or stale PR approval',()=>{
 for(const [key,change] of [
  ['runner','different-runner'],['runner_os','windows-latest'],['job_id','99']]){
  reject(x=>{x.metadata.records[0][key]=change;},/exact evidence mismatch/);
 }
 reject(x=>{x.metadata.records[0].review_head_sha=H('f');},/metadata snapshot/);
});
