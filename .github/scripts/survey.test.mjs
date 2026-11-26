import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {PUBLICATION_ASSETS} from './package-playground.mjs';
import {FORBIDDEN} from './audit-live-playground.mjs';
const read = p => readFileSync(new URL('../../'+p,import.meta.url),'utf8');
const code=read('survey-apps-script/Code.gs'), browser=read('survey/survey.js');
const context=vm.createContext({});vm.runInContext(code,context);
const catalog=vm.runInContext('TOPICS',context);
const sample={version:1,firstName:'A < B',lastName:'Example',email:'candidate@example.com',linkedin:'https://www.linkedin.com/in/candidate',github:'https://github.com/candidate',consent:true,ranked:Object.keys(catalog).slice(0,5).map((id,i)=>({id,rating:i+1}))};
const validate=p=>context.validate(JSON.stringify(p));
test('20 choices, exactly five unique ratings, safe email HTML',()=>{
 assert.equal(Object.keys(catalog).length,20);
 const p=validate(sample);const m=context.message(p);
 assert.match(m.html,/A &lt; B/);assert.doesNotMatch(m.html,/A < B/);assert.match(m.html,/5\/10/);
 assert.match(m.plain,/candidate@example.com/);
 const client=JSON.parse(browser.match(/const TOPICS = Object\.freeze\(([^\n]+)\);/)[1]);assert.deepEqual(client,JSON.parse(JSON.stringify(catalog)));
 for(const bad of [{...sample,ranked:sample.ranked.slice(1)},{...sample,ranked:[...sample.ranked.slice(0,4),sample.ranked[0]]},{...sample,ranked:sample.ranked.map(x=>({...x,rating:11}))},{...sample,consent:false},{...sample,email:'a@example.com,b@example.com'},{...sample,github:'https://github.com.evil.example/user'},{...sample,ranked:sample.ranked.map(x=>({...x,id:'__proto__'}))}])assert.throws(()=>validate(bad));
});
test('only public UI assets are published; unconfigured submission is disabled',()=>{
 const h=read('survey/index.html');
 for(const file of ['index.html','survey.js','survey.css'])assert.ok(PUBLICATION_ASSETS.includes('survey/'+file));
 assert.ok(!PUBLICATION_ASSETS.some(x=>x.startsWith('survey-apps-script/')));
 assert.ok(FORBIDDEN.includes('/survey-apps-script/Code.gs'));
 assert.match(h,/id="submit" disabled/);const endpoint=browser.match(/const ENDPOINT = '([^']*)';/)[1]; assert.ok(endpoint===''||/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(endpoint));assert.match(h,/form-action https:\/\/script.google.com/);
 assert.match(h,/data-page="1"/);assert.match(h,/data-page="2"/);assert.match(h,/data-page="3"/);
 assert.match(browser,/dragstart/);assert.match(browser,/dragover/);assert.match(browser,/drop/);
 new vm.Script(browser);
});
test('mail handler rejects disabled, duplicate and invalid submissions and sends one CC',()=>{
 let enabled=false,sent=[],data={},locked=false;
 const c=vm.createContext({HtmlService:{createHtmlOutput:x=>x},PropertiesService:{getScriptProperties:()=>({getProperty:k=>k==='SURVEY_ENABLED'?(enabled?'true':'false'):data[k],setProperty:(k,v)=>data[k]=v})},LockService:{getScriptLock:()=>({tryLock:()=>{locked=true;return true;},hasLock:()=>locked,releaseLock:()=>{locked=false;}})},Utilities:{formatDate:()=> '2026-11-26',base64EncodeWebSafe:x=>x,computeDigest:(_a,x)=>x,DigestAlgorithm:{SHA_256:1}},MailApp:{getRemainingDailyQuota:()=>100,sendEmail:x=>sent.push(x)}});
 vm.runInContext(code,c); const raw=JSON.stringify(sample),e={parameter:{payload:raw},parameters:{payload:[raw]}};
 assert.match(c.doPost(e),/Survey not submitted/);enabled=true;
 assert.match(c.doPost(e),/Survey submitted/);assert.equal(sent.length,1);assert.equal(sent[0].to,'alexander.d.mills@gmail.com');assert.equal(sent[0].cc,sample.email);assert.match(sent[0].htmlBody,/Ranked interests/);
 assert.match(c.doPost(e),/Survey not submitted/);assert.equal(sent.length,1);assert.equal(locked,false);
});

test('daily quota, lock contention, failed sends, rollover and HTML injection fail closed',()=>{
 let day='2026-11-26', enabled=true, quota=100, lockAvailable=true, locked=false, failSend=false, sent=[],data={};
 const c=vm.createContext({HtmlService:{createHtmlOutput:x=>x},PropertiesService:{getScriptProperties:()=>({getProperty:k=>k==='SURVEY_ENABLED'?(enabled?'true':'false'):data[k],setProperty:(k,v)=>data[k]=v})},LockService:{getScriptLock:()=>({tryLock:()=>{if(!lockAvailable)return false;locked=true;return true;},hasLock:()=>locked,releaseLock:()=>{locked=false;}})},Utilities:{formatDate:()=>day,base64EncodeWebSafe:x=>x,computeDigest:(_a,x)=>x,DigestAlgorithm:{SHA_256:1}},MailApp:{getRemainingDailyQuota:()=>quota,sendEmail:x=>{if(failSend)throw Error('send failed');sent.push(x);}}});
 vm.runInContext(code,c);
 const post=p=>{const raw=JSON.stringify(p);return c.doPost({parameter:{payload:raw},parameters:{payload:[raw]}});};
 const accepted=x=>assert.match(x,/<h1>Survey submitted<\/h1>/);
 const rejected=x=>assert.match(x,/<h1>Survey not submitted<\/h1>/);
 const p={...sample,firstName:'李 <&>',email:'test@example.com'};
 accepted(post(p));assert.match(sent[0].htmlBody,/李 &lt;&amp;&gt;/);
 rejected(post({...p,email:'TEST@example.com'}));assert.equal(sent.length,1);
 lockAvailable=false;rejected(post({...p,email:'lock@example.com'}));lockAvailable=true;
 quota=1;rejected(post({...p,email:'quota@example.com'}));quota=100;
 enabled=false;rejected(post({...p,email:'disabled@example.com'}));enabled=true;
 failSend=true;rejected(post({...p,email:'fail@example.com'}));failSend=false;
 assert.equal(locked,false);rejected(post({...p,email:'fail@example.com'}));
 for(let i=0;i<18;i++)accepted(post({...p,email:'candidate'+i+'@example.com'}));
 rejected(post({...p,email:'over@example.com'}));assert.equal(sent.length,19);
 day='2026-11-27';accepted(post(p));assert.equal(sent.length,20);
 for(const bad of [{...p,firstName:'A\nB'},{...p,ranked:p.ranked.map(x=>({...x,rating:2.5}))},{...p,linkedin:'https://linkedin.com.evil.invalid/in/foo'}])assert.throws(()=>c.validate(JSON.stringify(bad)));
 const raw=JSON.stringify({...p,email:'duplicate@example.com'});
 rejected(c.doPost({parameter:{payload:raw},parameters:{payload:[raw,raw]}}));
 assert.equal(sent.length,20);assert.equal(locked,false);
});

test('all eight new topic IDs are accepted, ordered and rendered in both ATS email formats',()=>{
 const expected={"real-time":"Soft vs. hard real-time systems","zero-gc":"Zero-GC runtimes across platforms and VMs","arena-allocation":"Custom heaps and arena allocation","target-architectures":"32-bit and ARM64 compilation (x86, ARM32, x86-64)","hdl-fpga":"HDL and FPGA compilation","soa-layout":"Structure of Arrays (SoA) data layouts","jit-tracing":"JIT compilation and runtime tracing","native-aot":"Native images and AOT compilation (GraalVM, .NET Native AOT)"};
 assert.deepEqual(Object.fromEntries(Object.keys(expected).map(id=>[id,catalog[id]])),expected);
 const ids=Object.keys(expected);
 for(const group of [ids.slice(0,5),ids.slice(3,8).reverse()]){
  const ranked=group.map((id,i)=>({id,rating:10-i}));
  const accepted=validate({...sample,ranked});
  assert.deepEqual(JSON.parse(JSON.stringify(accepted.ranked)),ranked);
  const m=context.message(accepted);
  let plainIndex=-1,htmlIndex=-1;
  for(const [i,id] of group.entries()){
   const plain=m.plain.indexOf((i+1)+'. '+expected[id]+' — '+ranked[i].rating+'/10');
   const html=m.html.indexOf(expected[id]);
   assert.ok(plain>plainIndex&&html>htmlIndex,'rank order and label for '+id);
   plainIndex=plain;htmlIndex=html;
  }
  assert.throws(()=>validate({...sample,ranked:[...ranked,ranked[0]]}));
  assert.throws(()=>validate({...sample,ranked:[...ranked.slice(0,4),ranked[0]]}));
 }
});
