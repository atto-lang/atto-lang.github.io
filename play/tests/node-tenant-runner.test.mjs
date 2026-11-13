import test from 'node:test';
import assert from 'node:assert/strict';
import { run_tenant } from '../src/node-tenant-runner.mjs';

// Build a real core-Wasm module with atto.actors custom section and guest
// spawn/send imports. No simulated actor callbacks or external compiler.
const leb = n => { const r = []; do { let b = n & 127; n >>>= 7; r.push(n ? b | 128 : b); } while (n); return r; };
const flat = (...xs) => xs.flat(Infinity);
const str = s => { const b = [...new TextEncoder().encode(s)]; return [...leb(b.length), ...b]; };
const section = (id, b) => [id, ...leb(b.length), ...b];
const exp = (s, kind, index) => [...str(s), kind, ...leb(index)];
const code = (...body) => { const b = [0, ...body, 0x0b]; return [...leb(b.length), ...b]; };

function guestWasm({ spin = false } = {}) {
  const main = code(
    0x41, 0, 0x10, 1, 0x1a,     // spawn Counter -> ref0; drop
    0x41, 0, 0x42, 1, 0x10, 2, // send(ref0,1)
    0x41, 0, 0x42, 2, 0x10, 2, // send(ref0,2)
    0x41, 0, 0x10, 1, 0x1a,    // spawn Counter -> ref1
    0x41, 1, 0x42, 3, 0x10, 2, // send(ref1,3)
    0x42, 0                    // return 0
  );
  const init = code(0x41, 0, 0x20, 0, 0x36, 2, 0);
  const receive = spin
    ? code(0x03, 0x40, 0x0c, 0, 0x0b) // loop { br 0 } forever
    : code(0x41, 0, 0x41, 0, 0x28, 2, 0, 0x41, 1, 0x6a,
        0x36, 2, 0, 0x41, 0, 0x28, 2, 0, 0xac, 0x10, 0);
  return new Uint8Array(flat(
    [0, 97, 115, 109, 1, 0, 0, 0],
    section(1, flat([6],
      [0x60, 0, 1, 0x7e], [0x60, 1, 0x7f, 0],
      [0x60, 3, 0x7f, 0x7e, 0x7e, 0], [0x60, 1, 0x7e, 0],
      [0x60, 1, 0x7f, 1, 0x7f], [0x60, 2, 0x7f, 0x7e, 0])),
    section(2, flat([3],
      str('atto'), str('print_i64'), [0, 3],
      str('atto'), str('actor_spawn'), [0, 4],
      str('atto'), str('actor_send'), [0, 5])),
    section(3, [3, 0, 1, 2]),
    section(5, [1, 1, 1, 1]),
    section(6, [1, 0x7f, 1, 0x41, 0, 0x0b]),
    section(7, flat([5], exp('main', 0, 3), exp('actor_init', 0, 4),
      exp('actor_receive', 0, 5), exp('memory', 2, 0),
      exp('panic_code', 3, 0))),
    section(10, flat([3], main, init, receive)),
    section(0, flat(str('atto.actors'), [1], str('Counter')))
  ));
}

test('Node tenant worker executes two independent Wasm32 actors with FIFO mail', async () => {
  const wasm = guestWasm();
  assert.equal(WebAssembly.validate(wasm), true);
  const result = await run_tenant(wasm, { deadline_ms: 3000 });
  assert.equal(result.ok, true, result.message);
  assert.equal(result.value, '0');
  assert.equal(result.actors, 2);
  assert.equal(result.stdout, '112');
});

test('Node parent terminates tenant worker even during an infinite Wasm call', async () => {
  const wasm = guestWasm({ spin: true });
  assert.equal(WebAssembly.validate(wasm), true);
  await assert.rejects(run_tenant(wasm, { deadline_ms: 100 }), /E_TENANT_TIMEOUT/);
});

test('Node tenant API refuses invalid input and deadline', () => {
  assert.throws(() => run_tenant(new Uint8Array((1 << 20) + 1)), /bounded guest/);
  assert.throws(() => run_tenant(new Uint8Array(), { deadline_ms: 0 }), /Invalid tenant deadline/);
});
