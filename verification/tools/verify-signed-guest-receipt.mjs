#!/usr/bin/env node
/**
 * Offline verifier for trusted, source-free guest-execution attestations.
 * The metadata collector is NOT a signer. No private keys, GitHub writes,
 * source trees, artifact downloads, or release certification are involved.
 *
 * Contract v1: strict flat-string payload, deterministic lexicographic JSON,
 * a domain-separated Ed25519 signature, explicitly scoped public keys,
 * a verifier-supplied challenge, revocation/replay ledgers and a fresh,
 * independently reviewed GitHub metadata snapshot.
 */
import {readFile} from 'node:fs/promises';
import {createPublicKey, verify as cryptoVerify} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {validateMetadataSnapshot} from './validate-metadata.mjs';

export const DOMAIN = 'AttoLang/guest-execution-receipt/v1\n';
export const ENVELOPE_SCHEMA = 'attolang.signed-guest-receipt.v1';
export const TRUST_SCHEMA = 'attolang.guest-trust-policy.v1';
const SHA=/^[a-f0-9]{40}$/;
const DIGEST=/^sha256:[a-f0-9]{64}$/;
const HEX=/^[a-f0-9]{64}$/;
const RID=/^[a-f0-9]{32}$/;
const REPO=/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const DEC=/^[1-9][0-9]{0,18}$/;
const LABEL=/^[A-Za-z0-9._:-]{1,120}$/;
const MODES=['native-aot','jvm-guest','wasm-runtime','browser-worker','forge-guest','dotnet-native-aot'];
const SKEW=5*60*1000, MAX_AGE=72*3600*1000, MAX_LIFETIME=24*3600*1000;
const bindings=['backend','feature','repository','pr','head_sha','tree_sha','ci_repository','mirror_repository','mirror_commit_sha','mirror_tree_sha','workflow_id','run_id','job_id','run_head_sha','run_attempt','job_run_attempt','runner','runner_os','artifact_name','artifact_sha256','contract_id','contract_version'];
const extras=['receipt_id','nonce','issued_at','expires_at','guest_execution_mode','guest_runtime_id','guest_binary_sha256','execution_log_sha256','guest_result_sha256','executed_cases','test_kind','test_result','contract_result'];
const payloadKeys=[...bindings,...extras];
const envelopeKeys=['schema','algorithm','key_id','payload','signature'];
const trustKeys=['schema','challenge_nonce','keys','revoked_receipt_ids','seen_receipt_ids'];
const keyKeys=['key_id','role','attestor_login','public_key_pem','not_before','not_after','revoked','allowed_repositories','allowed_backends','allowed_contracts'];

function ensure(cond, msg){if(!cond)throw new Error('Signed guest receipt rejected: '+msg);}
function exactKeys(o,keys,label){
  ensure(o&&typeof o==='object'&&!Array.isArray(o),label+' must be an object');
  ensure(Object.keys(o).length===keys.length&&Object.keys(o).every(k=>keys.includes(k)),label+' fields are missing or unexpected');
}
function time(value){
  return typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,19)===value.slice(0,19);
}
function arrayOfUniqueStrings(xs,pattern,max=50){
  return Array.isArray(xs)&&xs.length<=max&&xs.every(x=>typeof x==='string'&&pattern.test(x))&&new Set(xs).size===xs.length;
}
function timestamp(value,name,now,allowFuture=false){ensure(time(value),name+' invalid timestamp');const t=Date.parse(value);if(!allowFuture)ensure(t<=now+SKEW,name+' is in the future');return t;}

/** Exposed only to allow independent implementations to reproduce signature bytes. */
export function canonicalPayload(p){
  exactKeys(p,payloadKeys,'payload');
  for(const k of payloadKeys)ensure(typeof p[k]==='string','payload '+k+' must be a string');
  return JSON.stringify(Object.fromEntries(Object.entries(p).sort(([a],[b])=>a<b?-1:a>b?1:0)));
}
export function signingBytes(p){return Buffer.from(DOMAIN+canonicalPayload(p),'utf8');}

/**
 * Verification is read-only and consumes a verifier-authorized trust policy.
 * The trust policy and replay ledger MUST NOT be supplied by the receipt issuer.
 */
export function verifySignedGuestReceipt({envelope,metadata,trust,now=new Date()}){
  const epoch=now instanceof Date?now.getTime():NaN;
  ensure(Number.isFinite(epoch),'invalid verifier clock');
  const snapshot=validateMetadataSnapshot(metadata);
  exactKeys(envelope,envelopeKeys,'envelope');
  ensure(envelope.schema===ENVELOPE_SCHEMA&&envelope.algorithm==='Ed25519','unsupported envelope schema/algorithm');
  ensure(LABEL.test(envelope.key_id),'key ID invalid');
  ensure(typeof envelope.signature==='string'&&/^[A-Za-z0-9+/]{86}==$/.test(envelope.signature),'invalid Ed25519 signature encoding');
  const p=envelope.payload;
  const bytes=signingBytes(p);
  for(const key of ['head_sha','tree_sha','run_head_sha','mirror_commit_sha','mirror_tree_sha'])ensure(p[key]===''||SHA.test(p[key]),key+' invalid SHA');
  for(const key of ['artifact_sha256','guest_binary_sha256','execution_log_sha256','guest_result_sha256'])ensure(DIGEST.test(p[key]),key+' invalid digest');
  for(const key of ['pr','workflow_id','run_id','job_id','run_attempt','job_run_attempt','executed_cases'])ensure(DEC.test(p[key]),key+' invalid positive ID/count');
  ensure(RID.test(p.receipt_id)&&HEX.test(p.nonce),'receipt ID/challenge invalid');
  ensure(REPO.test(p.repository)&&REPO.test(p.ci_repository),'repository invalid');
  ensure(MODES.includes(p.guest_execution_mode)&&LABEL.test(p.guest_runtime_id),'guest runtime or execution mode invalid');
  ensure(p.test_kind==='guest'&&p.test_result==='passed'&&p.contract_result==='passed','receipt must attest executed passing guest cases');
  ensure(p.executed_cases!=='0'&&BigInt(p.executed_cases)<=10000000n,'guest case count out of bounds');
  const issued=timestamp(p.issued_at,'receipt issued_at',epoch);
  const expiry=timestamp(p.expires_at,'receipt expires_at',epoch,true);
  ensure(expiry>epoch&&expiry>issued&&expiry-issued<=MAX_LIFETIME,'receipt expired or overlong');
  ensure(epoch-issued<=MAX_AGE,'receipt too old');
  const collected=timestamp(snapshot.collected_at,'metadata collected_at',epoch);
  ensure(epoch-collected<=MAX_AGE,'metadata snapshot stale');
  const r=snapshot.records[0];
  const evidence=timestamp(r.evidence_at,'CI evidence_at',epoch);
  const artifactExpiry=timestamp(r.artifact_expires_at,'artifact expires_at',epoch,true);
  ensure(epoch-evidence<=MAX_AGE&&artifactExpiry>epoch,'CI metadata stale or artifact expired');
  ensure(issued>=evidence-SKEW,'receipt predates CI evidence');
  for(const k of bindings){
    ensure(p[k]===(r[k]||''),'exact evidence mismatch: '+k);
  }
  ensure(r.review_state==='approved'&&r.reviewer&&r.reviewer.toLowerCase()!==r.pr_author.toLowerCase()&&r.review_head_sha===r.head_sha,'independent current-head PR review required');
  ensure(r.run_status==='completed'&&r.run_conclusion==='success'&&r.job_conclusion==='success','CI run/job must pass');
  ensure(snapshot.release_certification==='NOT_CERTIFIED'&&snapshot.mode==='read-only-source-free','untrusted metadata cannot certify');

  exactKeys(trust,trustKeys,'trust policy');
  ensure(trust.schema===TRUST_SCHEMA,'unknown trust schema');
  ensure(HEX.test(trust.challenge_nonce)&&p.nonce===trust.challenge_nonce,'challenge nonce mismatch/replay');
  ensure(arrayOfUniqueStrings(trust.revoked_receipt_ids,RID,10000)&&arrayOfUniqueStrings(trust.seen_receipt_ids,RID,10000),'invalid revocation/replay ledger');
  ensure(!trust.revoked_receipt_ids.includes(p.receipt_id)&&!trust.seen_receipt_ids.includes(p.receipt_id),'revoked or replayed receipt');
  ensure(Array.isArray(trust.keys)&&trust.keys.length>=1&&trust.keys.length<=100,'missing/out-of-bounds trust keys');
  const ids=new Set();
  for(const k of trust.keys){
    exactKeys(k,keyKeys,'trusted key');
    ensure(LABEL.test(k.key_id)&&!ids.has(k.key_id),'duplicate/invalid trusted key');ids.add(k.key_id);
    ensure(k.role==='guest-execution-attestor'&&typeof k.revoked==='boolean'&&/^[A-Za-z0-9-]{1,39}$/.test(k.attestor_login),'trusted key invalid role/identity/revocation');
    ensure(typeof k.public_key_pem==='string'&&k.public_key_pem.length<1000&&!k.public_key_pem.includes('PRIVATE KEY'),'public key invalid');
    ensure(time(k.not_before)&&time(k.not_after)&&Date.parse(k.not_before)<Date.parse(k.not_after),'key validity window invalid');
    ensure(arrayOfUniqueStrings(k.allowed_repositories,REPO)&&k.allowed_repositories.length>0,'trusted repository scope invalid');
    ensure(arrayOfUniqueStrings(k.allowed_backends,/^(Java\/GraalVM|LLVM|Wasm|Forge\/Cranelift|\.NET)$/)&&k.allowed_backends.length>0,'backend scope invalid');
    ensure(arrayOfUniqueStrings(k.allowed_contracts,LABEL)&&k.allowed_contracts.length>0,'contract scope invalid');
  }
  const key=trust.keys.find(k=>k.key_id===envelope.key_id);
  ensure(key&&!key.revoked,'key missing/revoked');
  ensure(key.attestor_login.toLowerCase()!==r.pr_author.toLowerCase(),'attestor must be independent of PR author');
  ensure(epoch>=Date.parse(key.not_before)&&epoch<=Date.parse(key.not_after)&&issued>=Date.parse(key.not_before)&&issued<=Date.parse(key.not_after),'signer key expired/not yet valid');
  ensure(key.allowed_repositories.includes(p.repository)&&key.allowed_backends.includes(p.backend)&&key.allowed_contracts.includes(p.contract_id),'signer outside authorized scope');
  let pub;
  try{pub=createPublicKey(key.public_key_pem);}catch{ensure(false,'invalid signer public key PEM');}
  ensure(pub.asymmetricKeyType==='ed25519','trusted key is not Ed25519');
  const signature=Buffer.from(envelope.signature,'base64');
  ensure(signature.length===64&&signature.toString('base64')===envelope.signature,'noncanonical Ed25519 signature');
  ensure(cryptoVerify(null,bytes,pub,signature),'Ed25519 signature invalid');
  return Object.freeze({
    status:'SIGNED_GUEST_ATTESTATION_VERIFIED',
    release_certification:'NOT_CERTIFIED',
    merge_readiness:'ADVISORY_ONLY',
    receipt_id:p.receipt_id,
    key_id:envelope.key_id,
    backend:p.backend,
    feature:p.feature,
    contract_id:p.contract_id,
    contract_version:p.contract_version,
    executed_cases:p.executed_cases,
    head_sha:p.head_sha,
    run_id:p.run_id,
    run_attempt:p.run_attempt,
    artifact_sha256:p.artifact_sha256,
    expires_at:p.expires_at,
    note:'Signature and metadata binding verified. Guest execution remains an attestor claim; this is not an independent execution replay or release certificate.'
  });
}

/** Cross-backend view: only independently verified signed claims can contribute.
 * An aligned set of five signed claims is still not release certification. */
export function verifyFiveBackendSignedParity(entries,{now=new Date()}={}){
  ensure(Array.isArray(entries)&&entries.length>0&&entries.length<=5,'one to five signed backend receipts required');
  const accepted=entries.map(x=>verifySignedGuestReceipt({...x,now}));
  const backends=['Java/GraalVM','LLVM','Wasm','Forge/Cranelift','.NET'];
  ensure(new Set(accepted.map(x=>x.receipt_id)).size===accepted.length,'duplicate guest receipt ID');
  ensure(new Set(accepted.map(x=>x.backend)).size===accepted.length,'duplicate backend attestation');
  const first=accepted[0];
  ensure(accepted.every(x=>x.feature===first.feature&&x.contract_id===first.contract_id&&x.contract_version===first.contract_version),'contract/feature version mismatch');
  const missing=backends.filter(x=>!accepted.some(y=>y.backend===x));
  return Object.freeze({
    status:missing.length?'INCOMPLETE_SIGNED_GUEST_ATTESTATIONS':'FIVE_BACKEND_SIGNED_ATTESTATIONS_ALIGNED',
    covered_backends:accepted.map(x=>x.backend),missing_backends:missing,
    contract_id:first.contract_id,contract_version:first.contract_version,
    release_certification:'NOT_CERTIFIED',merge_readiness:'ADVISORY_ONLY',
    note:'Five independently checked signed assertions are not proof of an independent full guest execution or release authorization.'
  });
}

async function jsonFromFile(file){
  const raw=await readFile(file);ensure(raw.length>0&&raw.length<=2*1024*1024,'input missing or oversized');
  // Reject prototype-polluting keys before parsing. JSON round trips only through strict validators.
  let parsed;
  try{parsed=JSON.parse(raw.toString('utf8'));}catch{ensure(false,'invalid input JSON');}
  return parsed;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    const args=process.argv.slice(2);
    ensure(args.length===6&&args[0]==='--receipt'&&args[2]==='--metadata'&&args[4]==='--trust','usage: node verify-signed-guest-receipt.mjs --receipt signed.json --metadata snapshot.json --trust local-trust-policy.json');
    const [envelope,metadata,trust]=await Promise.all([jsonFromFile(args[1]),jsonFromFile(args[3]),jsonFromFile(args[5])]);
    process.stdout.write(JSON.stringify(verifySignedGuestReceipt({envelope,metadata,trust}),null,2)+'\n');
  }catch(e){
    process.stderr.write('NOT_CERTIFIED: '+(e.message||'receipt rejected')+'\n');process.exitCode=1;
  }
}
