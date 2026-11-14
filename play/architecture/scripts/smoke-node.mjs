#!/usr/bin/env node
// Source-free host canary. Never label this script compiler-backed Atto guest evidence.
import {Worker} from 'node:worker_threads';
import {writeFileSync} from 'node:fs';
const started_at=new Date().toISOString(),tests=[];
const record=(name,pass,detail)=>tests.push({name,pass,detail});
record('Node 22 or later',Number(process.versions.node.split('.')[0])>=22,process.version);
record('Native WebAssembly',typeof WebAssembly==='object',process.versions.v8);
let worker;
try{
 worker=new Worker(new URL('./node-probe-worker.mjs',import.meta.url));
 const result=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('timeout 4 seconds')),4000);worker.once('message',message=>{clearTimeout(timer);resolve(message);});worker.once('error',error=>{clearTimeout(timer);reject(error);});});
 if(result.error)throw Error(result.error);
 record('Worker runs Wasm main',result.answer===42,'source-free module result 42');
 record('Independent Wasm instances',result.distinct===true,'two distinct Wasm.Memory objects');
 record('Memory cannot alias sibling instance',result.unaliased===true,'write to A does not change B');
} catch(e){record('Worker Wasm canary',false,String(e));}finally{await worker?.terminate();}
try{const mem=new WebAssembly.Memory({initial:1,maximum:2});mem.grow(1);let threw=false;try{mem.grow(1);}catch(_){threw=true;}record('Bounded wasm32 memory',threw,'third page refused');}catch(e){record('Bounded wasm32 memory',false,String(e));}
const receipt={schema:'atto.sourcefree.node.probe.v1',classification:'SOURCE_FREE_HOST_ONLY',trusted_guest_receipt:false,started_at,completed_at:new Date().toISOString(),node:process.version,platform:process.platform,arch:process.arch,source_sha:null,compiler_sha:null,asset_sha256:null,steps_executed:tests.length,tests};
console.log(JSON.stringify(receipt,null,2));
if(process.argv[2]==='--out' && process.argv[3])writeFileSync(process.argv[3],JSON.stringify(receipt,null,2)+'\n');
if(tests.some(x=>!x.pass))process.exitCode=1;
