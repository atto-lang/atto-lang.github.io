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
test('12 choices, exactly five unique ratings, safe email HTML',()=>{
 assert.equal(Object.keys(catalog).length,12);
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
 assert.match(h,/id="submit" disabled/);assert.match(browser,/const ENDPOINT = ''/);assert.match(h,/form-action https:\/\/script.google.com/);
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
