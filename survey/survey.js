'use strict';
// Set only after deploying the reviewed Apps Script web app. No secrets here.
const ENDPOINT = '';
const TOPICS = Object.freeze({"js":"JavaScript transpiler (Atto → JavaScript)","rust":"Rust compiler (competes with LLVM and raw C++)","dotnet-isolates":"Wasm isolates (tenant VMs) for .NET","llvm":"LLVM compilation","forge":"C++ compilation without LLVM (Forge)","virtualization":"Hardware virtualization","java":"Java compiler (JVM and Graal isolates)","confidential":"Confidential compute","volucro":"Volucro VM for running Atto","browser-wasm":"Wasm for the browser","server-wasm":"Wasm for backend / Node.js / Bun / Deno","borrow":"Rust-based borrow checking (main/master borrow checker)"});
const selected = [], scores = Object.create(null);
const $ = id => document.getElementById(id);
const form = $('survey');
const say = value => { $('status').textContent = value; };
let page = 1, dragged = null, submitting = false;
function show(n) {
  page = n;
  document.querySelectorAll('[data-page]').forEach(p => { p.hidden = Number(p.dataset.page) !== n; });
  document.querySelectorAll('.steps li').forEach((li,i) => { if(i===n-1) li.setAttribute('aria-current','step'); else li.removeAttribute('aria-current'); });
  if(n===3) renderRatings();
  say('');
  $('heading'+n).focus();
}
function button(label, cls, fn) { const b=document.createElement('button'); b.type='button'; b.className=cls; b.textContent=label; b.addEventListener('click',fn); return b; }
function move(id,to) {
  const from=selected.indexOf(id);
  if(from<0 || to<0 || to>=selected.length || from===to) return;
  selected.splice(from,1); selected.splice(to,0,id); renderRanking();
  say(TOPICS[id]+' moved to rank '+(to+1));
}
function renderRanking() {
  $('available').replaceChildren(); $('ranking').replaceChildren();
  for(const [id,title] of Object.entries(TOPICS)) {
    if(selected.includes(id)) continue;
    const b=button('+ '+title,'topic',()=>{ if(selected.length<5){selected.push(id);renderRanking();say(title+' added at rank '+selected.length);if(selected.length===5)$('next2').focus();else $('available').querySelector('button:not(:disabled)')?.focus();} });
    b.disabled=selected.length===5; $('available').append(b);
  }
  selected.forEach((id,i)=>{
    const li=document.createElement('li'); li.draggable=true; li.dataset.id=id;
    const title=document.createElement('span'); title.textContent='⠿ '+TOPICS[id]; li.append(title);
    const actions=document.createElement('div'); actions.className='rank-actions';
    const up=button('↑ Up','move',()=>{move(id,i-1);focusMove(id,0);}); up.disabled=i===0; up.setAttribute('aria-label','Move '+TOPICS[id]+' up');
    const down=button('↓ Down','move',()=>{move(id,i+1);focusMove(id,1);}); down.disabled=i===selected.length-1; down.setAttribute('aria-label','Move '+TOPICS[id]+' down');
    const remove=button('Remove','move',()=>{selected.splice(i,1);delete scores[id];renderRanking();say(TOPICS[id]+' removed');$('available').querySelector('button:not(:disabled)')?.focus();}); remove.setAttribute('aria-label','Remove '+TOPICS[id]);
    actions.append(up,down,remove);li.append(actions);
    li.addEventListener('dragstart',e=>{dragged=id;li.classList.add('dragging');e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',id);});
    li.addEventListener('dragend',()=>{dragged=null;li.classList.remove('dragging');});
    li.addEventListener('dragover',e=>{if(dragged){e.preventDefault();e.dataTransfer.dropEffect='move';}});
    li.addEventListener('drop',e=>{e.preventDefault();if(dragged){move(dragged,selected.indexOf(id));dragged=null;}});
    $('ranking').append(li);
  });
  $('count').textContent=selected.length+' / 5'; $('next2').disabled=selected.length!==5;
}
function focusMove(id,index){const li=[...$('ranking').children].find(x=>x.dataset.id===id);const buttons=li?.querySelectorAll('button');if(buttons)(buttons[index].disabled?buttons[1-index]:buttons[index]).focus();}
function renderRatings(){
  $('ratings').replaceChildren();
  selected.forEach((id,i)=>{
    const row=document.createElement('label');row.className='rating';
    const title=document.createElement('span');title.textContent=(i+1)+'. '+TOPICS[id];
    const select=document.createElement('select'); select.required=true;select.setAttribute('aria-label','Skill rating for '+TOPICS[id]);
    const blank=new Option('Choose 1–10','');select.append(blank);
    for(let n=1;n<=10;n++) select.append(new Option(String(n),String(n)));
    select.value=scores[id]||'';select.addEventListener('change',()=>{if(select.value)scores[id]=Number(select.value);else delete scores[id];});
    row.append(title,select);$('ratings').append(row);
  });
}
function profileValid(value,domain,kind){
  if(!value)return true;
  try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&!u.search&&!u.hash&&(u.hostname===domain||u.hostname==='www.'+domain)&&kind.test(u.pathname);}catch{return false;}
}
const emailPattern=/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,63}$/;
function validContact(){
  for(const id of ['firstName','lastName','email','linkedin','github']){
    const el=$(id);el.setCustomValidity('');
    if((id==='firstName'||id==='lastName')&&!el.value.trim())el.setCustomValidity('Enter your name.');
    if(id==='email'&&(!emailPattern.test(el.value.trim())||el.value.includes('..')))el.setCustomValidity('Enter a valid email address.');
    if(id==='linkedin'&&!profileValid(el.value.trim(),'linkedin.com',/^\/in\/[A-Za-z0-9_%.-]+\/?$/))el.setCustomValidity('Enter a public LinkedIn profile URL.');
    if(id==='github'&&!profileValid(el.value.trim(),'github.com',/^\/[A-Za-z0-9-]+\/?$/))el.setCustomValidity('Enter a GitHub profile URL.');
    if(!el.reportValidity())return false;
  }return true;
}
function configured(){return /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(ENDPOINT);}
$('next1').addEventListener('click',()=>{if(validContact())show(2);});
$('next2').addEventListener('click',()=>{if(selected.length===5)show(3);});
document.querySelectorAll('[data-back]').forEach(b=>b.addEventListener('click',()=>show(Number(b.dataset.back))));
form.addEventListener('keydown',e=>{if(e.key==='Enter'&&page===1&&e.target.tagName==='INPUT'){e.preventDefault();if(validContact())show(2);}});
form.addEventListener('submit',e=>{
  e.preventDefault();
  if(page!==3||submitting||!configured())return;
  if(!validContact()){show(1);return;}
  if(selected.length!==5||new Set(selected).size!==5||selected.some(id=>!Number.isInteger(scores[id])||scores[id]<1||scores[id]>10)||!$('consent').checked){say('Complete all five ratings and consent before submitting.');return;}
  $('payload').value=JSON.stringify({version:1,firstName:$('firstName').value.trim(),lastName:$('lastName').value.trim(),email:$('email').value.trim(),linkedin:$('linkedin').value.trim(),github:$('github').value.trim(),ranked:selected.map(id=>({id,rating:scores[id]})),consent:true});
  form.action=ENDPOINT; submitting=true;$('submit').disabled=true;say('Submitting to Google Apps Script…');HTMLFormElement.prototype.submit.call(form);
});
if(configured()){$('submit').disabled=false;}else{$('configuration').textContent='Email submission is not yet configured. You can preview the survey, but cannot send answers.';}
window.addEventListener('pageshow',()=>{submitting=false;$('submit').disabled=!configured();$('payload').value='';});
renderRanking();
