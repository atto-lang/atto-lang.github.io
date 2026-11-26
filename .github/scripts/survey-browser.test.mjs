import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const run=promisify(execFile);
const read=p=>readFile(new URL('../../'+p,import.meta.url),'utf8');
const fakeEndpoint='https://script.google.com/macros/s/test_fixture/exec';

// Real Chromium DOM and native form validation, with network submission
// intercepted before any external call. Synthetic drag events exercise the
// handlers; no claim of real physical pointer or actual email delivery.
const driver=String.raw`
(() => {
 const assert=(v,m)=>{if(!v)throw Error(m)};
 const $=id=>document.getElementById(id);
 const click=id=>$(id).click();
 const set=(id,value)=>{$(id).value=value;$(id).dispatchEvent(new Event('input',{bubbles:true}));};
 const page=n=>!document.querySelector('[data-page="'+n+'"]').hidden;
 const order=()=>Array.from($('ranking').children,x=>x.dataset.id);
 const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
 const rate=()=>Array.from($('ratings').querySelectorAll('select'));
 const select=(el,v)=>{el.value=String(v);el.dispatchEvent(new Event('change',{bubbles:true}));};
 let captured=[];
 HTMLFormElement.prototype.submit=function(){captured.push({action:this.action,method:this.method,payload:JSON.parse($('payload').value)});};
 try {
  const configured=location.pathname==='/configured/';
  assert(page(1)&&!page(2)&&!page(3),'initial page');
  click('next1');assert(page(1),'required names');
  set('firstName','李 <&>');set('lastName','Example');set('email','invalid');
  click('next1');assert(page(1),'bad email');
  set('email','candidate@example.com');set('github','https://github.com.evil.invalid/user');
  click('next1');assert(page(1),'bad profile');
  set('github','https://github.com/candidate');
  $('email').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
  assert(page(2),'enter navigation');
  assert($('available').children.length===12&&$('next2').disabled,'12 projects');
  for(let i=0;i<5;i++)$('available').querySelector('button:not(:disabled)').click();
  assert(order().length===5&&!$('next2').disabled,'exact five');
  assert([...$('available').children].every(b=>b.disabled),'sixth disabled');
  assert(same(order(),['js','rust','dotnet-isolates','llvm','forge']),'selection order');
  const dt=new DataTransfer();
  $('ranking').children[4].dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:dt}));
  $('ranking').children[0].dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:dt}));
  $('ranking').children[0].dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt}));
  assert(same(order(),['forge','js','rust','dotnet-isolates','llvm']),'drag reorder');
  $('ranking').children[0].querySelectorAll('button')[1].click();
  assert(same(order(),['js','forge','rust','dotnet-isolates','llvm']),'keyboard button reorder');
  click('next2');assert(page(3)&&rate().length===5,'five ratings');
  assert(rate().every(x=>x.value===''),'no default skill');
  rate().forEach((x,i)=>select(x,i+1));
  document.querySelector('[data-back="2"]').click();
  $('ranking').children[0].querySelectorAll('button')[1].click();
  click('next2');assert(same(rate().map(x=>x.value),['2','1','3','4','5']),'ratings follow IDs');
  document.querySelector('[data-back="2"]').click();
  $('ranking').children[0].querySelectorAll('button')[2].click();
  assert($('next2').disabled&&order().length===4,'remove requires replacement');
  $('available').querySelector('button:not(:disabled)').click();
  click('next2');assert(rate()[4].value==='','replacement has blank rating');
  if(configured){
   click('submit');assert(captured.length===0,'missing skill/consent prevents submit');
   select(rate()[4],10);click('submit');assert(captured.length===0,'consent required');
   $('consent').checked=true;click('submit');assert(captured.length===1,'exactly one submission');
   assert(captured[0].action==='https://script.google.com/macros/s/test_fixture/exec'&&captured[0].method==='post','correct POST endpoint');
   const p=captured[0].payload;assert(p.email==='candidate@example.com'&&p.firstName==='李 <&>'&&p.consent===true,'payload contact');
   assert(same(p.ranked.map(x=>x.id),['js','rust','dotnet-isolates','llvm','forge']),'payload order');
   assert(same(p.ranked.map(x=>x.rating),[1,3,4,5,10]),'payload scores');
   $('survey').dispatchEvent(new Event('submit',{cancelable:true,bubbles:true}));assert(captured.length===1,'duplicate blocked');
  }else{
   assert($('submit').disabled&&$('configuration').textContent.includes('not yet configured'),'fail closed');
   $('survey').dispatchEvent(new Event('submit',{cancelable:true,bubbles:true}));assert(captured.length===0,'unconfigured no send');
  }
  document.body.dataset.surveyTest='PASS';
 }catch(e){document.body.dataset.surveyTest='FAIL';document.body.append(document.createTextNode(e.stack));}
})();
`;

test('Chromium executes all three survey steps, ranking, validation and intercepted POST',async t=>{
 const chromium=process.env.CHROME_BIN||['google-chrome','chromium','chromium-browser'].find(x=>{try{return requireExecutable(x)}catch{return false}});
 assert.ok(chromium,'Chromium is required for the survey browser regression');
 const html=(await read('survey/index.html')).replace('</body>','<script src="./driver.js" defer></script></body>');
 const js=await read('survey/survey.js'),css=await read('survey/survey.css');
 const site=await read('assets/site.css'),logo=await read('assets/atto-logo.svg'),mark=await read('assets/atto-mark.svg');
 const server=createServer((req,res)=>{
  const p=new URL(req.url,'http://localhost').pathname;
  const configured=p.startsWith('/configured/');
  const path=p.split('/').at(-1);
  let content,type;
  if(!path){content=html;type='text/html';}
  else if(path==='survey.js'){content=js.replace(/const ENDPOINT = '[^']*';/,"const ENDPOINT = '"+(configured?fakeEndpoint:'')+"';");type='text/javascript';}
  else if(path==='driver.js'){content=driver;type='text/javascript';}
  else if(path==='survey.css'){content=css;type='text/css';}
  else if(path==='site.css'){content=site;type='text/css';}
  else if(path==='atto-logo.svg'||path==='atto-mark.svg'){content=path==='atto-logo.svg'?logo:mark;type='image/svg+xml';}
  else{res.writeHead(404);res.end();return;}
  res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store'});res.end(content);
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 for(const mode of ['unconfigured','configured']){
  const profile=await mkdtemp(join(tmpdir(),'atto-survey-browser-'));
  try{
   const {stdout}=await run(chromium,['--headless','--no-sandbox','--disable-dev-shm-usage','--disable-background-networking','--no-first-run','--user-data-dir='+profile,'--dump-dom','http://127.0.0.1:'+server.address().port+'/'+mode+'/'],{timeout:30000,maxBuffer:1024*1024});
   assert.match(stdout,/data-survey-test="PASS"/,mode+' Chromium DOM result: '+stdout.slice(-2500));
  }finally{await rm(profile,{recursive:true,force:true});}
 }
});
function requireExecutable(name){return process.env.PATH.split(':').some(dir=>existsSync(join(dir,name)));}
import {existsSync} from 'node:fs';
