import {SNAPSHOT,ROUTES,COMPARISON,EVIDENCE,TASKS,CHECKLISTS} from './data.js';

const $ = (id) => document.getElementById(id);
const escapeHtml = (v) => String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const shortSha = (s,n=10) => s ? s.slice(0,n)+'…'+s.slice(-7) : 'unknown';
const STORAGE_KEY = 'attolang-architecture-board-v1';
let state = {tasks:{},checks:{},receipts:[]};
try {
  const parsed=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null');
  if(parsed && typeof parsed==='object') {
    state.tasks=parsed.tasks && typeof parsed.tasks==='object' ? parsed.tasks : {};
    state.checks=parsed.checks && typeof parsed.checks==='object' ? parsed.checks : {};
    state.receipts=Array.isArray(parsed.receipts)?parsed.receipts.slice(0,100):[];
  }
} catch(_) { /* Storage may be unavailable. Site continues in memory. */ }
const save=()=>{try{localStorage.setItem(STORAGE_KEY,JSON.stringify(state));}catch(_){toast('Local storage unavailable; changes last only this session.');}};
let route='rust',host='browser',selectedNode=1,checklist='browser',lastProbe=null,toastTimer;
function toast(s){const t=$('toast');t.textContent=s;t.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('show'),3600);}
function statusHTML(s){const m={documented:['documented','Documented'],target:['target','Target'],missing:['missing','No receipt'],unsupported:['unsupported','Unsupported']};const [cls,label]=m[s]||m.missing;return `<span class="status-pill ${cls}">${label}</span>`;}
function updateGateCount(){$('open-gate-count').textContent=TASKS.filter(t=>state.tasks[t.id]!=='done').length;}
function renderMap(){
 const r=ROUTES[route],steps=r[host];
 $('route-label').textContent=`${r.label} · ${host.toUpperCase()}`;
 $('map-path-status').textContent=r.kicker;
 $('route-warning').textContent=r.note;
 $('architecture-map').innerHTML=steps.map((it,i)=>{
  const cls=it[2]==='Target'?'plan':it[2]==='Unsupported'?'unsupported':'';
  const glyph=['{ }','⚙','◇','⌘','⬡'][i];
  return `<button type="button" class="arch-node ${cls} ${i===selectedNode?'selected':''}" data-node="${i}" aria-pressed="${i===selectedNode}"><span class="node-dot"></span><span class="node-step">${String(i+1).padStart(2,'0')} / ${escapeHtml(it[1].toUpperCase())}</span><span class="node-glyph">${glyph}</span><b>${escapeHtml(it[0])}</b><small>${escapeHtml(it[2])}</small></button>`;
 }).join('');
 $('architecture-map').querySelectorAll('[data-node]').forEach(el=>el.addEventListener('click',()=>{selectedNode=Number(el.dataset.node);renderMap();}));
 const n=steps[selectedNode];$('inspector-title').textContent=n[0];$('inspector-description').textContent=n[3];$('inspector-caveat').textContent=n[4];
 const badge=$('inspector-status');badge.className='status-pill '+(n[2]==='Target'?'target':n[2]==='Unsupported'?'unsupported':'documented');badge.textContent=n[2];
 document.querySelectorAll('[data-route]').forEach(el=>{const on=el.dataset.route===route;el.classList.toggle('on',on);el.setAttribute('aria-selected',String(on));});
 document.querySelectorAll('[data-host]').forEach(el=>el.classList.toggle('is-on',el.dataset.host===host));
}
document.querySelectorAll('[data-route]').forEach(el=>el.addEventListener('click',()=>{route=el.dataset.route;selectedNode=1;renderMap();}));
document.querySelectorAll('[data-host]').forEach(el=>el.addEventListener('click',()=>{host=el.dataset.host;selectedNode=1;renderMap();}));
function renderComparison(){
 const cards=[
  {id:'01 / WEBASSEMBLY',title:'Rust → Wasm → Wasm',body:'The public browser compiler is written in Rust (atto-source.rs), built as compiler Wasm, and emits a guest Wasm subset. Both compiler and guest use browser-native WebAssembly.',tags:['Browser ✓','Node ✓','Actors unproven']},
  {id:'02 / LLVM PIPELINE',title:'Native → direct Wasm',body:'oreslang-source.wasm invokes native LLVM/Clang to emit core wasm32 and executes it in Node worker_threads. The native compiler does not run in the page.',tags:['Browser target','Node documented','No Wasmtime browser']},
  {id:'03 / ECMASCRIPT',title:'JS transpilation → ESM',body:'oreslang-source.js emits JavaScript ESM. Trusted host module Web Workers or Node worker_threads serially handle calls; source actor lowering remains unfinished.',tags:['Browser ✓','Node ✓','JS GC']}
 ];
 $('comparison-cards').innerHTML=cards.map(c=>`<article class="compare-card"><div class="cmp-top"><span class="cmp-id">${escapeHtml(c.id)}</span><span class="status-pill documented">DOCUMENTED PATH</span></div><h3>${escapeHtml(c.title)}</h3><p>${escapeHtml(c.body)}</p><div class="compare-foot">${c.tags.map(t=>`<span>${escapeHtml(t)}</span>`).join('')}</div></article>`).join('');
 $('matrix-body').innerHTML=COMPARISON.map(r=>`<tr>${r.map(c=>`<td>${escapeHtml(c)}</td>`).join('')}</tr>`).join('');
}
function renderEvidence(){const q=$('board-search').value.trim().toLowerCase();const heads=new Map(SNAPSHOT.heads.map(h=>[h.id,h]));$('evidence-rows').innerHTML=EVIDENCE.filter(e=>[e.name,e.sub,e.compile,e.browser,e.node,e.release].join(' ').toLowerCase().includes(q)).map(e=>{
 const h=heads.get(e.id);return `<tr><td><strong>${escapeHtml(e.name)}</strong><small>${escapeHtml(e.sub)}</small>${h?`<small>HEAD: <a href="https://github.com/${encodeURI(h.repo)}/commit/${h.sha}" rel="noopener noreferrer" target="_blank">${escapeHtml(shortSha(h.sha))} ↗</a></small>`:''}</td><td>${statusHTML(e.compile)}</td><td>${statusHTML(e.browser)}</td><td>${statusHTML(e.node)}</td><td>${statusHTML(e.actor)}</td><td class="release-txt">${escapeHtml(e.release)}</td></tr>`;
 }).join('')||'<tr><td colspan="6">No matching artifacts.</td></tr>';
 $('import-count').textContent=`${state.receipts.length} imported unverified claim${state.receipts.length===1?'':'s'}`;
}
$('board-search').addEventListener('input',renderEvidence);
function renderProvenance(){
 const p=SNAPSHOT.compiler;
 const fields=[['Source repo',p.source_repository],['Compiler source head',p.source_head],['Compiler source tree',p.source_tree],['Compiler binary SHA-256',p.compiler_sha256],['Binary size',p.compiler_bytes+' bytes'],['Compiler ABI',String(p.compiler_abi)],['Guest ABI',p.guest_abi],['Target',p.target],['Runtime source SHA','Not bound by compiler receipt'],['Deployed Pages SHA','Unknown · verify independently']];
 $('compiler-fields').innerHTML=fields.map(([k,v])=>`<div><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>`).join('');
 $('sha-grid').innerHTML=SNAPSHOT.heads.map(h=>`<article class="sha-card"><div><b>${escapeHtml(h.repo)}</b><a href="https://github.com/${encodeURI(h.repo)}/commit/${h.sha}" rel="noopener noreferrer" target="_blank">↗</a></div><small>${escapeHtml(h.role)}</small><code>${escapeHtml(h.sha)}</code></article>`).join('');
}
async function digestHex(bytes){const digest=await crypto.subtle.digest('SHA-256',bytes);return Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');}
async function verifyAssets(){
 const button=$('verify-assets'),out=$('asset-result');button.disabled=true;out.className='validation-result';out.textContent='Reading same-origin compiler receipt and WebAssembly bytes…';
 try{
  if(!window.isSecureContext)throw Error('Requires a secure context (HTTPS or localhost) for SHA-256 verification.');
  const receiptURL=new URL('../public/atto_compiler.receipt.json',location.href);
  const wasmURL=new URL('../public/atto_compiler.wasm',location.href);
  const [r,w]=await Promise.all([fetch(receiptURL,{cache:'no-store'}),fetch(wasmURL,{cache:'no-store'})]);
  if(!r.ok||!w.ok)throw Error(`Same-origin assets unavailable (receipt HTTP ${r.status}, Wasm HTTP ${w.status}); this is expected in the standalone preview.`);
  const receipt=await r.json(),bytes=await w.arrayBuffer();
  if(bytes.byteLength>20_000_000)throw Error('Compiler asset is unexpectedly large.');
  const actual=await digestHex(bytes);
  if(actual!==receipt.compiler_sha256)throw Error('FAIL CLOSED: deployed compiler digest does not match deployed receipt.');
  if(bytes.byteLength!==receipt.compiler_bytes)throw Error('FAIL CLOSED: deployed compiler length does not match receipt.');
  if(actual!==SNAPSHOT.compiler.compiler_sha256 || receipt.source_head!==SNAPSHOT.compiler.source_head)throw Error('Compiler byte/receipt match, but this board snapshot is stale. Review and update the pinned source before certifying the release.');
  out.className='validation-result good';out.textContent=`Byte readback matched compiler receipt and board pin: ${actual}. This does NOT establish a Pages deploy SHA, a signed release manifest, an executed guest test or independent review.`;
 }catch(e){out.className='validation-result bad';out.textContent=e.message;}finally{button.disabled=false;}
}
$('verify-assets').addEventListener('click',verifyAssets);
async function verifySiteAssets(){
 const button=$('verify-site-assets'),out=$('site-asset-result');button.disabled=true;out.className='validation-result';out.textContent='Reading same-origin release manifest and verifying six static assets…';
 try{
  if(!window.isSecureContext)throw Error('Requires HTTPS or localhost for SHA-256 verification.');
  const res=await fetch(new URL('../../release-manifest.json',location.href),{cache:'no-store'});
  if(!res.ok)throw Error('Reviewed release manifest unavailable (HTTP '+res.status+'). Expected in standalone preview.');
  const manifest=await res.json();
  if(manifest.schema!==1||!manifest.assets||!/^[a-f0-9]{40}$/.test(String(manifest.source_commit||'')))throw Error('Missing a source-commit-bound release manifest.');
  const paths=['index.html','styles.css','data.js','app.js','receipt.js','probe-worker.js'];
  for(const file of paths){
   const entry=manifest.assets['play/architecture/'+file];
   if(!entry||!/^[a-f0-9]{64}$/.test(String(entry.sha256||'')))throw Error('Manifest omits architecture/'+file);
   const response=await fetch(new URL('./'+file,location.href),{cache:'no-store'});
   if(!response.ok)throw Error('Deployed asset missing: '+file);
   const bytes=await response.arrayBuffer();
   if(bytes.byteLength>1_048_576||entry.size!==bytes.byteLength||await digestHex(bytes)!==entry.sha256)throw Error('FAIL CLOSED: asset byte/readback mismatch: '+file);
  }
  out.className='validation-result good';out.textContent='6/6 deployed site asset digests match same-origin release manifest at source commit '+manifest.source_commit+'. Readback alone is not an Actions job or review receipt.';
 }catch(e){out.className='validation-result bad';out.textContent=e.message;}finally{button.disabled=false;}
}
$('verify-site-assets').addEventListener('click',verifySiteAssets);
function renderTasks(){const f=$('priority-filter').value;const tasks=TASKS.filter(t=>f==='all'||t.priority===f);
 $('task-list').innerHTML=tasks.map(t=>`<article class="task"><span class="task-n">${escapeHtml(t.id)}</span><div><div class="task-heading"><span class="priority ${t.priority}">${t.priority}</span><h3>${escapeHtml(t.title)}</h3></div><p>${escapeHtml(t.desc)}</p><div class="accept"><b>ACCEPTANCE →</b> ${escapeHtml(t.accept)}</div></div><div class="task-action"><select aria-label="Status of ${escapeHtml(t.title)}" data-task="${t.id}"><option value="todo">To do</option><option value="inprogress">In progress</option><option value="blocked">Blocked</option><option value="done">Done locally</option></select><small>${escapeHtml(t.area.toUpperCase())}</small></div></article>`).join('');
 $('task-list').querySelectorAll('[data-task]').forEach(el=>{el.value=state.tasks[el.dataset.task]||'todo';el.addEventListener('change',()=>{state.tasks[el.dataset.task]=el.value;save();updateGateCount();});});updateGateCount();
}
$('priority-filter').addEventListener('change',renderTasks);$('reset-tasks').addEventListener('click',()=>{state.tasks={};save();renderTasks();toast('Task statuses reset locally.');});
function renderChecklist(){
 $('checklist-tabs').innerHTML=CHECKLISTS.map(c=>`<button type="button" role="tab" data-checktab="${c.id}" class="${c.id===checklist?'active':''}" aria-selected="${c.id===checklist}">${escapeHtml(c.label)}</button>`).join('');
 $('checklist-tabs').querySelectorAll('button').forEach(el=>el.addEventListener('click',()=>{checklist=el.dataset.checktab;renderChecklist();}));
 const c=CHECKLISTS.find(x=>x.id===checklist);$('checklist-kicker').textContent=c.label.toUpperCase();$('checklist-title').textContent=c.name;$('checklist-intro').textContent=c.intro;
 $('checklist-items').innerHTML=c.items.map((it,i)=>{const key=c.id+':'+i;const checked=Boolean(state.checks[key]);return `<label class="check-item ${checked?'done':''}"><input type="checkbox" data-check="${key}" ${checked?'checked':''}><span>${escapeHtml(it)}</span></label>`;}).join('');
 $('checklist-items').querySelectorAll('[data-check]').forEach(el=>el.addEventListener('change',()=>{state.checks[el.dataset.check]=el.checked;save();renderChecklist();}));
 const checked=c.items.filter((_,i)=>state.checks[c.id+':'+i]).length,percent=Math.round(checked/c.items.length*100);
 $('check-progress').textContent=percent+'%';$('progress-ring').style.background=`conic-gradient(var(--mint) ${percent}%,#2b4450 ${percent}%)`;
}
$('reset-checklist').addEventListener('click',()=>{const c=CHECKLISTS.find(x=>x.id===checklist);c.items.forEach((_,i)=>delete state.checks[c.id+':'+i]);save();renderChecklist();toast('Current checklist reset.');});
$('copy-checklist').addEventListener('click',async()=>{const c=CHECKLISTS.find(x=>x.id===checklist);const body=`# ${c.name}\n\n${c.intro}\n\n`+c.items.map((s,i)=>`- [${state.checks[c.id+':'+i]?'x':' '}] ${s}`).join('\n')+`\n\n> Local checklist is NOT a CI execution receipt.\n`;
 try{await navigator.clipboard.writeText(body);toast('Markdown checklist copied.');}catch(_){downloadText('attolang-'+c.id+'-checklist.md',body,'text/markdown');toast('Clipboard unavailable; saved Markdown file instead.');}
});
function downloadText(filename,text,mime='application/json'){const blob=new Blob([text],{type:mime});const url=URL.createObjectURL(blob);const anchor=document.createElement('a');anchor.href=url;anchor.download=filename;document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('export-state').addEventListener('click',()=>{const doc={schema:'atto.architecture.board.v1',snapshot:SNAPSHOT,trust_note:'Source snapshot and local observations only; imported receipts unverified',state};downloadText('attolang-architecture-board.json',JSON.stringify(doc,null,2));toast('Local board exported.');});
// Imports are deliberately treated as unverified claims even when all fields are well formed.

function renderReceipts(){ $('import-count').textContent=`${state.receipts.length} imported unverified claims`;
 if(!state.receipts.length){$('receipt-list').innerHTML='<div class="empty-state">No receipts imported. Import JSON to compare declared SHAs and executed steps. Imported data never changes the trusted counter.</div>';return;}
 const list=$('receipt-list');list.textContent='';
 state.receipts.slice().reverse().forEach((v,i)=>{const e=document.createElement('div');e.className='receipt-entry';const body=document.createElement('div'),title=document.createElement('strong'),desc=document.createElement('p');title.textContent=`${v.artifact_id} · ${v.environment} · ${v.result}`;desc.textContent=`run ${v.run_id} / attempt ${v.attempt} / ${v.steps_executed} steps / ${shortSha(v.repo_sha)}`;body.append(title,desc);const pill=document.createElement('span');pill.className='status-pill target';pill.textContent=v.steps_executed===0?'NO STEPS':'UNVERIFIED CLAIM';e.append(body,pill);list.append(e);});
}
function openDialog(){$('receipt-dialog').showModal();$('import-error').textContent='';}function closeDialog(){$('receipt-dialog').close();}
$('import-open').addEventListener('click',openDialog);$('close-dialog').addEventListener('click',closeDialog);$('cancel-import').addEventListener('click',closeDialog);
$('receipt-file').addEventListener('change',async(e)=>{const file=e.target.files?.[0];if(!file)return;if(file.size>512000){$('import-error').textContent='File too large (limit 500 KiB).';return;}$('receipt-json').value=await file.text();$('import-error').textContent='';});
$('confirm-import').addEventListener('click',()=>{try{const value=$('receipt-json').value;if(value.length>512000)throw Error('JSON too large.');const v=validateReceipt(JSON.parse(value));if(state.receipts.length>=100)throw Error('Limit of 100 local receipts reached.');state.receipts.push(v);save();renderReceipts();closeDialog();toast('Imported as unverified claim; no trust promotion.');}catch(e){ $('import-error').textContent=e.message;}});
$('receipt-dialog').addEventListener('click',e=>{if(e.target===$('receipt-dialog'))closeDialog();});
function renderProbes(items){const grid=$('probe-grid');grid.textContent='';items.forEach(x=>{const wrap=document.createElement('div');wrap.className='probe-card';const dot=document.createElement('span');dot.className='probe-dot'+(x.pass?'':' fail');const words=document.createElement('div'),label=document.createElement('b'),info=document.createElement('small');label.textContent=x.name;info.textContent=x.detail;words.append(label,info);wrap.append(dot,words);grid.append(wrap);});}
async function runProbes(){
 const b=$('run-probes');b.disabled=true;$('probe-summary').textContent='Executing source-free browser capability tests…';$('download-probe').disabled=true;
 const started=new Date().toISOString(),items=[];
 items.push({name:'Browser WebAssembly API',pass:typeof WebAssembly==='object',detail:typeof WebAssembly});
 items.push({name:'Web Worker API',pass:typeof Worker==='function',detail:typeof Worker});
 items.push({name:'Secure context',pass:window.isSecureContext,detail:window.isSecureContext?'HTTPS/localhost compatible':'Not a secure context'});
 items.push({name:'Shared memory availability',pass:window.crossOriginIsolated===true&&typeof SharedArrayBuffer==='function',detail:`optional; crossOriginIsolated=${window.crossOriginIsolated===true}`});
 try{
  if(typeof Worker!=='function')throw Error('Web Worker API missing');
  const worker=new Worker(new URL('./probe-worker.js',import.meta.url),{type:'module',name:'atto-source-free-probe'});
  const result=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Worker probe exceeded 6 seconds')),6000);worker.addEventListener('message',e=>{clearTimeout(timer);resolve(e.data);},{once:true});worker.addEventListener('error',()=>{clearTimeout(timer);reject(Error('Worker probe error'));},{once:true});worker.postMessage({kind:'probe'});}).finally(()=>worker.terminate());
  for(const item of result.tests||[])items.push(item);
 }catch(e){items.push({name:'Wasm Worker canary',pass:false,detail:e.message});}
 renderProbes(items);const passed=items.filter(x=>x.pass).length;$('probe-summary').textContent=`${passed}/${items.length} host checks positive. Shared memory is optional; these are not guest or CI receipts.`;
 lastProbe={schema:'atto.sourcefree.browser.probe.v1',classification:'SOURCE_FREE_HOST_ONLY',trusted_guest_receipt:false,started_at:started,completed_at:new Date().toISOString(),page:location.href,engine:navigator.userAgent,site_snapshot:SNAPSHOT.date,tests:items,steps_executed:items.length};$('download-probe').disabled=false;b.disabled=false;
}
$('run-probes').addEventListener('click',runProbes);$('download-probe').addEventListener('click',()=>{if(lastProbe)downloadText('attolang-sourcefree-browser-probe.json',JSON.stringify(lastProbe,null,2));});
const navLinks=[...document.querySelectorAll('[data-nav]')];navLinks.forEach(n=>n.addEventListener('click',()=>{navLinks.forEach(x=>x.classList.remove('active'));n.classList.add('active');}));
renderMap();renderComparison();renderEvidence();renderProvenance();renderTasks();renderChecklist();renderReceipts();
