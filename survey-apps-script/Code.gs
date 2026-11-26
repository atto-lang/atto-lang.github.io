// AttoLang contributor survey. Deploy as a web app executing as its owner.
// Mail is sent only to the fixed recipient, with the respondent in CC.
const TOPICS = Object.freeze({"js":"JavaScript transpiler (Atto → JavaScript)","rust":"Rust compiler (competes with LLVM and raw C++)","dotnet-isolates":"Wasm isolates (tenant VMs) for .NET","llvm":"LLVM compilation","forge":"C++ compilation without LLVM (Forge)","virtualization":"Hardware virtualization","java":"Java compiler (JVM and Graal isolates)","confidential":"Confidential compute","volucro":"Volucro VM for running Atto","browser-wasm":"Wasm for the browser","server-wasm":"Wasm for backend / Node.js / Bun / Deno","borrow":"Rust-based borrow checking (main/master borrow checker)"});
const RECIPIENT = 'alexander.d.mills@gmail.com';
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function clean(s,max,required){if(typeof s!=='string'||s.length>max||/[\x00-\x1f\x7f]/.test(s)||required&&!s.trim())throw new Error('Invalid field');return s.trim();}
function profile(s,kind){
  s=clean(s,250,false);if(!s)return '';
  const pattern=kind==='linkedin'?/^https:\/\/(?:www\.)?linkedin\.com\/in\/[A-Za-z0-9_%.-]+\/?$/i:/^https:\/\/(?:www\.)?github\.com\/[A-Za-z0-9-]+\/?$/i;
  if(!pattern.test(s))throw new Error('Invalid profile');return s;
}
function validate(raw){
  if(typeof raw!=='string'||raw.length>4096)throw new Error('Invalid payload');
  const p=JSON.parse(raw);
  if(!p||p.version!==1||p.consent!==true||!Array.isArray(p.ranked)||p.ranked.length!==5)throw new Error('Incomplete survey');
  const email=clean(p.email,254,true);
  if(!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,63}$/.test(email)||email.includes('..'))throw new Error('Invalid email');
  const seen=new Set();
  const ranked=p.ranked.map(x=>{if(!x||typeof x.id!=='string'||!Object.prototype.hasOwnProperty.call(TOPICS,x.id)||seen.has(x.id)||!Number.isInteger(x.rating)||x.rating<1||x.rating>10)throw new Error('Invalid ranking');seen.add(x.id);return {id:x.id,rating:x.rating};});
  return {firstName:clean(p.firstName,80,true),lastName:clean(p.lastName,80,true),email,linkedin:profile(p.linkedin,'linkedin'),github:profile(p.github,'github'),ranked};
}
function message(p){
  const fields=[['First name',p.firstName],['Last name',p.lastName],['Email',p.email],['LinkedIn',p.linkedin||'Not provided'],['GitHub',p.github||'Not provided']];
  const rows=p.ranked.map((x,i)=>'<tr><td style="padding:12px;border-bottom:1px solid #e1e5ef">'+(i+1)+'</td><td style="padding:12px;border-bottom:1px solid #e1e5ef">'+escapeHtml(TOPICS[x.id])+'</td><td style="padding:12px;border-bottom:1px solid #e1e5ef;font-weight:bold">'+x.rating+'/10</td></tr>').join('');
  const html='<div style="font-family:Arial,sans-serif;color:#17213b;max-width:680px;margin:auto"><div style="padding:24px;background:#121b30;color:white;border-radius:12px"><div style="font-size:12px;letter-spacing:2px;color:#c7bdff">ATTOLANG · CONTRIBUTOR SURVEY</div><h1 style="font-size:25px">New contributor response</h1><p>'+escapeHtml(p.firstName+' '+p.lastName)+'</p></div><h2>Contact details</h2><table style="width:100%;border-collapse:collapse">'+fields.map(x=>'<tr><th scope="row" style="padding:8px;text-align:left;width:120px">'+escapeHtml(x[0])+'</th><td style="padding:8px;overflow-wrap:anywhere">'+escapeHtml(x[1])+'</td></tr>').join('')+'</table><h2>Ranked interests &amp; skill ratings</h2><table style="width:100%;border-collapse:collapse"><thead><tr style="background:#ebe8ff;text-align:left"><th style="padding:12px">Rank</th><th style="padding:12px">Project</th><th style="padding:12px">Skill</th></tr></thead><tbody>'+rows+'</tbody></table><p style="color:#5b6580;font-size:13px">1 = beginner · 10 = expert. The respondent requested a copy by email.</p></div>';
  const plain='AttoLang contributor survey\n'+fields.map(x=>x.join(': ')).join('\n')+'\n\n'+p.ranked.map((x,i)=>(i+1)+'. '+TOPICS[x.id]+' — '+x.rating+'/10').join('\n');
  return {html,plain};
}
function receipt(ok){
  return HtmlService.createHtmlOutput('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>AttoLang survey</title></head><body style="font:18px system-ui;background:#0b1020;color:#e7ebf8;padding:32px"><h1>'+(ok?'Survey submitted':'Survey not submitted')+'</h1><p>'+(ok?'Thank you for contributing! Your response was accepted by the mail service and a copy was addressed to you.':'The response could not be accepted. Check your answers or try again later. No successful delivery is confirmed.')+'</p><a target="_top" style="color:#c7d1ff" href="https://atto-lang.github.io/survey/">Return to AttoLang</a></body></html>');
}
function doGet(){return receipt(false);}
function doPost(e){
  let lock;
  try{
    const p=validate(e&&e.parameter&&e.parameter.payload);
    if(!e.parameters||!e.parameters.payload||e.parameters.payload.length!==1)throw new Error('Duplicate payload');
    const props=PropertiesService.getScriptProperties();
    // Fail closed until an administrator explicitly enables submission.
    if(props.getProperty('SURVEY_ENABLED')!=='true')throw new Error('Disabled');
    lock=LockService.getScriptLock();if(!lock.tryLock(5000))throw new Error('Busy');
    const day=Utilities.formatDate(new Date(),'UTC','yyyy-MM-dd');
    const key='SURVEY_RATE';let state=JSON.parse(props.getProperty(key)||'null');
    if(!state||state.day!==day)state={day,count:0,emails:{}};
    const hash=Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,p.email.toLowerCase()));
    if(state.count>=20||Object.prototype.hasOwnProperty.call(state.emails,hash)||MailApp.getRemainingDailyQuota()<2)throw new Error('Rate limited');
    // Reserve before sending to prevent retry storms and duplicate concurrent mail.
    state.count++;state.emails[hash]=true;props.setProperty(key,JSON.stringify(state));
    const m=message(p);
    MailApp.sendEmail({to:RECIPIENT,cc:p.email,subject:'AttoLang contributor survey response',body:m.plain,htmlBody:m.html,name:'AttoLang Contributor Survey'});
    return receipt(true);
  }catch(err){return receipt(false);}finally{if(lock&&lock.hasLock())lock.releaseLock();}
}
