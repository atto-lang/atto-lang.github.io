// Candidate-only full 60-preview acceptance and executable guest oracle.
// Publication tests use the checked-in pinned compiler in a separate worktree.
// This test does not reclassify any published preview as released.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createCompiler} from '../src/compiler.js';
import {guestImports,actorNames,pipeGuestAbi,describePanic} from '../src/guest.js';
import {requireGuestAbiV2} from '../src/actor-abi-version.js';
import {validateGuestImportABI} from '../src/guest-import-abi.js';
import {admitWasm32Memory} from '../src/wasm-memory-admission.js';
import {stateGuestProfile} from '../src/state-guest-profile.js';
import {createStateRuntime} from '../src/state-runtime.js';

const enabled = process.env.ATTO_VERIFY_PRIVATE_PREVIEWS === '1';
const root = new URL('../',import.meta.url);
const contract = JSON.parse(await readFile(new URL('private-candidate-preview-golden.json',import.meta.url),'utf8'));

test('private candidate: all 60 actual preview sources have a strict guest execution or no-artifact verdict', {
  skip: !enabled && 'Full candidate tests run only with a separately verified private compiler in isolated CI'
}, async t => {
  assert.equal(contract.schema,'atto.private.preview-execution.v1');
  assert.equal(contract.provenance.publish,false);
  assert.equal(process.env.ATTO_PRIVATE_COMPILER_HEAD,contract.provenance.compiler_source);
  assert.match(process.env.ATTO_PRIVATE_SITE_HEAD||'',/^[a-f0-9]{40}$/);
  const receipt=JSON.parse(await readFile(new URL('public/atto_compiler.receipt.json',root),'utf8'));
  const binary=await readFile(new URL('public/atto_compiler.wasm',root));
  assert.equal(receipt.source_head,process.env.ATTO_PRIVATE_COMPILER_HEAD);
  assert.equal(receipt.compiler_sha256,createHash('sha256').update(binary).digest('hex'));
  assert.equal(receipt.compiler_bytes,binary.length);
  assert.equal(receipt.compiler_abi,2);
  assert.equal(receipt.guest_abi,'atto.browser.guest.v2');
  assert.ok(WebAssembly.validate(binary),'candidate compiler itself must be genuine Wasm');
  const compiler=await createCompiler(binary);
  const filenames=(await readdir(new URL('examples/preview/',root)))
    .filter(n=>n.endsWith('.atto')).map(n=>n.slice(0,-5)).sort();
  assert.equal(filenames.length,60);
  assert.deepEqual(filenames,Object.keys(contract.cases).sort());
  const summary={total:0,executed:0,rejected:0,failed:0};
  for(const name of filenames){
    const expected=contract.cases[name];
    await t.test(name+' '+expected.kind,async()=>{
      const source=await readFile(new URL('examples/preview/'+name+'.atto',root),'utf8');
      const result=compiler.compile(source);
      summary.total++;
      if(expected.kind==='reject'){
        assert.equal(result.ok,false,'unexpected new candidate execution: '+name);
        assert.equal(Object.hasOwn(result,'wasm'),false,'rejected source leaked Wasm: '+name);
        assert.match(result.diagnostics?.[0]?.message??'',new RegExp('^'+expected.code+':'));
        assert.ok(result.diagnostics[0].line>=1&&result.diagnostics[0].column>=1);
        summary.rejected++;
      }else{
        assert.equal(result.ok,true,JSON.stringify(result.diagnostics));
        assert.ok(WebAssembly.validate(result.wasm),'real guest bytes required: '+name);
        admitWasm32Memory(result.wasm);
        const module=await WebAssembly.compile(result.wasm);
        requireGuestAbiV2(module);
        const actors=actorNames(module);
        assert.equal(actors.length,0,'unreviewed actor host for '+name);
        const pipeline=pipeGuestAbi(module);
        const state=stateGuestProfile(module,{actorTypes:actors.length,pipeline});
        assert.equal(state,name==='state-containers','unexpected state profile: '+name);
        validateGuestImportABI(result.wasm,module,{allowState:state,allowPipeline:pipeline});
        const output={text:'',truncated:false};
        const runtime=state?createStateRuntime({maxContainers:1024,maxTickets:1024,requireBoundMemory:true}):null;
        const {imports,bind}=guestImports(module,output,null,null,runtime);
        const instance=await WebAssembly.instantiate(module,imports);
        bind(instance);
        let value;
        try {
          value=instance.exports.main();
          runtime?.complete();
        }catch(error){
          runtime?.abort();
          assert.fail(name+': real guest trap '+describePanic(instance,error));
        }
        assert.equal(typeof value,'bigint');
        assert.equal(value.toString(),expected.value);
        assert.equal(output.text,expected.stdout,'guest stdout drift: '+name);
        assert.equal(output.truncated,false,'unexpected output cap');
        summary.executed++;
      }
      // Every successful/failed candidate transaction must recover cleanly.
      const recovery=compiler.compile('pub fnc main(): int { return 42; }');
      assert.equal(recovery.ok,true,name+' poisoned compiler state');
      assert.ok(WebAssembly.validate(recovery.wasm));
    });
  }
  assert.deepEqual(summary,{total:60,executed:22,rejected:38,failed:0});
  console.log('PRIVATE_CANDIDATE_60_PREVIEW_MATRIX',JSON.stringify(summary));
});
