#!/usr/bin/env node
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const files=['index.html','styles.css','data.js','receipt.js','app.js','probe-worker.js','README.md','scripts/smoke-node.mjs','scripts/node-probe-worker.mjs','scripts/generate-manifest.mjs','scripts/verify.mjs','scripts/serve.mjs','tests/receipt.test.mjs','examples/receipt.example.json'];
const hashes=Object.fromEntries(files.map(f=>[f,createHash('sha256').update(readFileSync(path.join(root,f))).digest('hex')]));
const manifest={schema:'atto.architecture.site.release-manifest.v1',generated_at:new Date().toISOString(),source_repo:'atto-lang/atto-lang.github.io',source_commit:null,disclosure_status:'not_applicable_to_dashboard',deployment_url:null,deployed_readback_status:'NOT_CHECKED',files:hashes,limitations:['This local manifest is not proof of deployment.','A Pages deployment must bind source commit and HTTPS readback before certification.','No guest execution evidence is implied.']};
writeFileSync(path.join(root,'site-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log('Generated site-manifest.json with '+files.length+' file digests.');
