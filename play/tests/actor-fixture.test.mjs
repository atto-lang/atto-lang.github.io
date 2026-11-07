import test from 'node:test';
import assert from 'node:assert/strict';
import { actorProgramFixture } from './actor-fixture.mjs';

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
