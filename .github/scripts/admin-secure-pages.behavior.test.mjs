import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,delimiter} from 'node:path';
import {fileURLToPath} from 'node:url';

const target=fileURLToPath(new URL('./admin-secure-pages.mjs',import.meta.url));
const repos=['atto-lang/atto-lang.github.io','atto-lang/atto-source.rs'];

// A standalone fake gh executable. It records every write and simulates
// GitHub administration responses with persistent state across invocations.
const fakeGh=[
  '#!/usr/bin/env node',
  'import fs from "node:fs";',
  'const file=process.env.GH_MOCK_STATE;',
  'const s=JSON.parse(fs.readFileSync(file,"utf8"));',
  'const args=process.argv.slice(2);',
  'if(args[0]!=="api")process.exit(91);',
  'const path=args[1];',
  'const pos=args.indexOf("--method");',
  'const method=pos<0?"GET":args[pos+1];',
  'let output;',
  'const match=/^\\/repos\\/([^/]+\\/[^/]+)\\/(.*)$/.exec(path);',
  'const repo=match?.[1];const suffix=match?.[2];',
  'if(method==="GET"){',
  '  if(path==="/user")output={login:"the1mills"};',
  '  else if(path==="/users/ORESoftware")output={id:555,login:"ORESoftware"};',
  '  else if(suffix==="branches/main")output=s.repos[repo]?.branch;',
  '  else if(suffix==="rulesets?per_page=100"&&repo==="atto-lang/atto-source.rs"&&process.env.GH_MOCK_PRIVATE_PLAN==="blocked"){process.stderr.write("Upgrade to GitHub Pro or make this repository public");process.exit(1);}',
  '  else if(suffix==="rulesets?per_page=100")output=s.repos[repo]?.rulesets;',
  '  else if(/^rulesets\\/\\d+$/.test(suffix||""))output=s.repos[repo]?.rulesets.find(x=>String(x.id)===suffix.split("/")[1]);',
  '  else if(suffix==="pages")output=s.pages;',
  '  else if(suffix==="environments/github-pages")output=s.environment;',
  '  else process.exit(92);',
  '}else{',
  '  const data=JSON.parse(fs.readFileSync(0,"utf8"));',
  '  s.operations.push({method,path});',
  '  if(method==="POST"&&suffix==="rulesets"){',
  '    const next={...data,id:99+s.repos[repo].rulesets.length};',
  '    s.repos[repo].rulesets.push(next);s.repos[repo].branch.protected=true;output=next;',
  '  }else if(method==="PUT"&&suffix==="environments/github-pages"){',
  '    s.environment={name:"github-pages",deployment_branch_policy:data.deployment_branch_policy,',
  '      protection_rules:[{type:"required_reviewers",prevent_self_review:data.prevent_self_review,',
  '      reviewers:data.reviewers.map(r=>({type:r.type,reviewer:{id:r.id}}))}]};output=s.environment;',
  '  }else if(method==="PUT"&&suffix==="pages"){',
  '    s.pages={...s.pages,...data};output=null;',
  '  }else process.exit(93);',
  '  fs.writeFileSync(file,JSON.stringify(s));',
  '}',
  'if(output!==null)process.stdout.write(JSON.stringify(output));'
].join('\n')+'\n';

async function harness(t){
  const folder=await mkdtemp(join(tmpdir(),'atto-gh-admin-mock-'));
  t.after(()=>rm(folder,{recursive:true,force:true}));
  const executable=join(folder,'gh'),stateFile=join(folder,'state.json');
  const state={repos:Object.fromEntries(repos.map(r=>[r,{
    branch:{name:'main',protected:false,commit:{sha:'b'.repeat(40)}},
    rulesets:[]
  }])),pages:{build_type:'legacy',https_enforced:false},
  environment:{name:'github-pages',
    deployment_branch_policy:{protected_branches:false,custom_branch_policies:true},
    protection_rules:[]},operations:[]};
  await writeFile(executable,fakeGh,{mode:0o755});
  await writeFile(stateFile,JSON.stringify(state));
  const read=async()=>JSON.parse(await readFile(stateFile,'utf8'));
  const write=async x=>writeFile(stateFile,JSON.stringify(x));
  const run=(args,extra={})=>spawnSync(process.execPath,[target,...args],{
    encoding:'utf8',timeout:10000,
    env:{...process.env,PATH:folder+delimiter+process.env.PATH,
      GH_MOCK_STATE:stateFile,ATTO_ADMIN_APPLY:'',...extra}
  });
  return {run,read,write};
}
test('default --check only reads GitHub and reports missing protections',async t=>{
  const h=await harness(t);
  const r=h.run(['--check']);
  assert.equal(r.status,2,r.stderr);
  assert.match(r.stderr,/NOT READY/);
  assert.deepEqual((await h.read()).operations,[]);
});
test('missing explicit apply confirmation makes zero GitHub mutations',async t=>{
  const h=await harness(t);
  const r=h.run(['--apply']);
  assert.notEqual(r.status,0);
  assert.match(r.stderr,/Refusing mutation/);
  assert.deepEqual((await h.read()).operations,[]);
});
test('administrator applies both no-bypass rulesets before environment and Pages cutover',async t=>{
  const h=await harness(t);
  const r=h.run(['--apply'],{ATTO_ADMIN_APPLY:'YES'});
  assert.equal(r.status,0,r.stderr);
  assert.match(r.stdout,/PASS: protected main/);
  const s=await h.read();
  assert.deepEqual(s.operations.map(x=>x.method+':'+x.path),[
    'POST:/repos/atto-lang/atto-lang.github.io/rulesets',
    'POST:/repos/atto-lang/atto-source.rs/rulesets',
    'PUT:/repos/atto-lang/atto-lang.github.io/environments/github-pages',
    'PUT:/repos/atto-lang/atto-lang.github.io/pages'
  ]);
  assert.equal(s.pages.build_type,'workflow');
  assert.equal(s.pages.https_enforced,true);
  assert.ok(repos.every(repo=>s.repos[repo].branch.protected));
  assert.ok(repos.every(repo=>s.repos[repo].rulesets[0].bypass_actors.length===0));
  assert.deepEqual(s.environment.protection_rules[0].reviewers[0],
    {type:'User',reviewer:{id:555}});
  const second=h.run(['--check']);
  assert.equal(second.status,0,second.stderr);
  assert.match(second.stdout,/PASS: admin gates/);
  assert.equal((await h.read()).operations.length,4,'read-only postcheck wrote nothing');
});
test('pre-existing unexpected reviewer aborts before any write',async t=>{
  const h=await harness(t);
  const s=await h.read();
  s.environment.protection_rules=[
    {type:'required_reviewers',prevent_self_review:true,
      reviewers:[{type:'User',reviewer:{id:999}}]}
  ];
  await h.write(s);
  const r=h.run(['--apply'],{ATTO_ADMIN_APPLY:'YES'});
  assert.notEqual(r.status,0);
  assert.match(r.stderr,/manual reconciliation/);
  assert.deepEqual((await h.read()).operations,[]);
});

test('GitHub private-plan restriction blocks full setup before any write',async t=>{
  const h=await harness(t);
  const r=h.run(['--apply'],{
    ATTO_ADMIN_APPLY:'YES',GH_MOCK_PRIVATE_PLAN:'blocked'});
  assert.notEqual(r.status,0);
  assert.match(r.stderr,/E_ADMIN_PRIVATE_RULESET_UNAVAILABLE/);
  assert.deepEqual((await h.read()).operations,[]);
});
test('public-site-only setup succeeds without querying private compiler rulesets',async t=>{
  const h=await harness(t);
  const noRights={GH_MOCK_PRIVATE_PLAN:'blocked'};
  const before=h.run(['--check-site'],noRights);
  assert.equal(before.status,2,before.stderr);
  const r=h.run(['--apply-site'],{...noRights,ATTO_ADMIN_APPLY:'YES'});
  assert.equal(r.status,0,r.stderr);
  assert.match(r.stdout,/PRIVATE compiler ruleset NOT VERIFIED/);
  const s=await h.read();
  assert.deepEqual(s.operations.map(x=>x.method+':'+x.path),[
    'POST:/repos/atto-lang/atto-lang.github.io/rulesets',
    'PUT:/repos/atto-lang/atto-lang.github.io/environments/github-pages',
    'PUT:/repos/atto-lang/atto-lang.github.io/pages'
  ]);
  assert.equal(s.repos['atto-lang/atto-source.rs'].branch.protected,false);
  assert.equal(s.pages.build_type,'workflow');
  const checked=h.run(['--check-site'],noRights);
  assert.equal(checked.status,0,checked.stderr);
  assert.match(checked.stdout,/PASS: admin gates/);
  assert.equal((await h.read()).operations.length,3);
  const all=h.run(['--check'],noRights);
  assert.notEqual(all.status,0);
  assert.match(all.stderr,/E_ADMIN_PRIVATE_RULESET_UNAVAILABLE/);
});
test('site-only check still fails if the ruleset targets the wrong branch',async t=>{
  const h=await harness(t);
  assert.equal(h.run(['--apply-site'],{ATTO_ADMIN_APPLY:'YES'}).status,0);
  const s=await h.read();
  s.repos['atto-lang/atto-lang.github.io'].rulesets[0]
    .conditions.ref_name.include=['refs/heads/experimental'];
  await h.write(s);
  const check=h.run(['--check-site']);
  assert.equal(check.status,2,check.stderr);
  assert.match(check.stderr,/NOT READY/);
});
