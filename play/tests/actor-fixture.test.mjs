import test from 'node:test';
import assert from 'node:assert/strict';
import { actorProgramFixture, scalarV0ActorFixture } from './actor-fixture.mjs';
import { integratedActorExports } from '../src/guest.js';

test('source-free actor fixture has real Wasm actor imports and exports', () => {
  for (const twoActors of [false, true]) {
    const bytes = actorProgramFixture({twoActors});
    assert.equal(WebAssembly.validate(bytes), true);
    const module = new WebAssembly.Module(bytes);
    assert.deepEqual(WebAssembly.Module.imports(module).map(x => x.name),
      ['actor_spawn','actor_send','actor_join']);
    assert.deepEqual(WebAssembly.Module.exports(module).map(x => x.name),
      ['main','panic_code','atto_actor_receive_0']);
  }
});

test('distinct Wasm instances do not share mutable actor globals', () => {
  const module = new WebAssembly.Module(actorProgramFixture());
  const noop = {
    atto: {actor_spawn:()=>1, actor_send:()=>0, actor_join:()=>{}}
  };
  const a = new WebAssembly.Instance(module, noop);
  const b = new WebAssembly.Instance(module, noop);
  assert.equal(a.exports.atto_actor_receive_0(41n),42n);
  assert.equal(a.exports.atto_actor_receive_0(41n),43n);
  assert.equal(b.exports.atto_actor_receive_0(41n),42n);
});

test('legacy scalar.v0 receiver fails integrated.v1 validation before execution', () => {
  const legacy = new WebAssembly.Module(scalarV0ActorFixture());
  assert.deepEqual(WebAssembly.Module.exports(legacy).map(x=>x.name), ['receive']);
  assert.deepEqual(WebAssembly.Module.imports(legacy), []);
  assert.throws(() => integratedActorExports(legacy), /E_ACTOR_ABI_MISMATCH/);
  assert.throws(() => integratedActorExports(legacy,0), /E_ACTOR_ABI_MISMATCH/);
});

test('integrated.v1 actor bytecode cannot be passed as standalone scalar.v0', () => {
  const integrated = new WebAssembly.Module(actorProgramFixture());
  assert.deepEqual([...integratedActorExports(integrated)], ['atto_actor_receive_0']);
  assert.deepEqual([...integratedActorExports(integrated,0)], ['atto_actor_receive_0']);
  assert.throws(() => integratedActorExports(integrated,1), /E_ACTOR_ABI_MISMATCH/);
  assert.equal(WebAssembly.Module.exports(integrated).some(x=>x.name==='receive'),false);
  assert.ok(WebAssembly.Module.imports(integrated).length > 0,
    'not an import-free standalone scalar.v0 actor guest');
});
