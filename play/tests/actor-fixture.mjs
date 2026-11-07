/** Source-free test module: proves isolated browser workers, not compiler support. */
const leb = n => {
  const out = [];
  do { let b = n % 128; n = Math.floor(n / 128); if (n) b |= 128; out.push(b); } while (n);
  return out;
};
const str = s => [...leb(Buffer.byteLength(s)), ...Buffer.from(s, 'utf8')];
const section = (id, bytes) => [id, ...leb(bytes.length), ...bytes];
const fnType = (args, result) => [0x60, ...leb(args.length), ...args, ...leb(result.length), ...result];
const funcImport = (name, signature) => [...str('atto'), ...str(name), 0, ...leb(signature)];
const exportFunc = (name, idx) => [...str(name), 0, ...leb(idx)];
const exportGlobal = (name, idx) => [...str(name), 3, ...leb(idx)];
const body = bytes => [...leb(bytes.length), ...bytes];

/** A guest whose main spawns two actors and sends them the same value.
 * receive uses a mutable global that must belong separately to each worker.
 */
export function actorProgramFixture({ twoActors = true } = {}) {
  const i32 = 0x7f, i64 = 0x7e;
  const types = [
    fnType([], [i64]),
    fnType([i64], [i64]),
    fnType([i32], [i32]),
    fnType([i32, i64], [i32]),
    fnType([i32], []),
  ];
  const init = [
    0x41, 0, 0x10, 0, 0x21, 0,
    ...(twoActors ? [0x41, 0, 0x10, 0, 0x21, 1] : []),
    0x20, 0, 0x42, 41, 0x10, 1, 0x1a,
    ...(twoActors ? [0x20, 1, 0x42, 41, 0x10, 1, 0x1a] : []),
    0x20, 0, 0x10, 2,
    ...(twoActors ? [0x20, 1, 0x10, 2] : []),
    0x42, 42, 0x0b,
  ];
  const receive = [
    0,
    0x23, 1, 0x42, 1, 0x7c, 0x24, 1,
    0x20, 0, 0x23, 1, 0x7c, 0x0b,
  ];
  const main = [...(twoActors ? [1,2,i32] : [1,1,i32]), ...init];
  const bytes = Uint8Array.from([
    0,97,115,109,1,0,0,0,
    ...section(1, [...leb(types.length), ...types.flat()]),
    ...section(2, [3, ...funcImport('actor_spawn',2), ...funcImport('actor_send',3), ...funcImport('actor_join',4)]),
    ...section(3, [2,0,1]),
    ...section(6, [2, i32,1,0x41,0,0x0b, i64,1,0x42,0,0x0b]),
    ...section(7, [3, ...exportFunc('main',3), ...exportGlobal('panic_code',0), ...exportFunc('atto_actor_receive_0',4)]),
    ...section(10, [2, ...body(main), ...body(receive)]),
  ]);
  if (!WebAssembly.validate(bytes)) throw new Error('Invalid source-free actor fixture');
  return bytes;
}
