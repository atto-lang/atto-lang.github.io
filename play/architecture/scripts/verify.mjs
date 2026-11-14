#!/usr/bin/env node
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import {SNAPSHOT,ROUTES,COMPARISON,EVIDENCE,TASKS,CHECKLISTS} from '../data.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const manifest=JSON.parse(readFileSync(path.join(root,'site-manifest.json'),'utf8'));
let cases=0;const check=(v,msg)=>{assert.ok(v,msg);cases++;};
for(const [f,digest] of Object.entries(manifest.files)){const actual=createHash('sha256').update(readFileSync(path.join(root,f))).digest('hex');check(actual===digest,`Digest mismatch: ${f}`);}
check(SNAPSHOT.heads.length>=5,'Source heads missing');
for(const h of SNAPSHOT.heads)check(/^[a-f0-9]{40}$/.test(h.sha),'Invalid repo commit SHA '+h.repo);
check(/^[a-f0-9]{40}$/.test(SNAPSHOT.compiler.source_head),'Compiler source head absent');
check(/^[a-f0-9]{64}$/.test(SNAPSHOT.compiler.compiler_sha256),'Compiler digest missing');
check(SNAPSHOT.compiler.compiler_bytes>0,'Compiler size missing');
check(Object.keys(ROUTES).length===3,'Route count mismatch');
check(['rust','direct','js'].every(r=>ROUTES[r].browser.length===5&&ROUTES[r].node.length===5),'Incomplete map lanes');
check(COMPARISON.length>=10,'Comparison incomplete');
check(EVIDENCE.length>=5,'Verification registry incomplete');
check(TASKS.length>=10,'Hardening queue incomplete');
check(CHECKLISTS.length>=3,'Checklists incomplete');
for(const c of CHECKLISTS)check(c.items.length>=8,`Incomplete checklist ${c.id}`);
const html=readFileSync(path.join(root,'index.html'),'utf8');
check(html.includes("default-src 'none'"),'Missing fail-closed CSP');
check(html.includes('script type="module" src="./app.js"'),'Missing executable UI module');
check(html.includes('32-bit heap pointers') || html.includes('u32 / wasm32'),'32-bit pointer visibility absent');
console.log(`SITE VERIFICATION: ${cases}/${cases} structural assertions passed (source-free only).`);
