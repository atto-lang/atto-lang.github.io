// Exact-source browser gate for the independently reviewed scalar/v1 corpus
// in oreslang-source.js, oreslang-source.wasm and oreslang-source.net.
// This is a limited *shared scalar profile*, not full language/backend parity.
// Every input is pinned to its canonical Git blob SHA-1; all successful guests
// execute in a real WebAssembly VM. No generated JS evaluation or mock compiler.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createCompiler } from '../src/compiler.js';
import { guestImports } from '../src/guest.js';

const EXPECTED_MANIFEST_BLOB = 'fd9df902b2df734ac62875037ca66db3ea41bc6b';
const CASES = Object.freeze([
  {
    "id": "scalar.literal-42",
    "kind": "accept",
    "value": "42",
    "sha1": "08b48c0ccd063bc863fb35b9e59d5c2ee6bc37d4",
    "source": "pub fnc main(): int { return 42; }\n"
  },
  {
    "id": "scalar.precedence",
    "kind": "accept",
    "value": "28",
    "sha1": "2dca1f2a9510bf5648850d8b38328fe38fe9aeed",
    "source": "pub fnc main(): int { return 4 + 6 * (5 - 1); }\n"
  },
  {
    "id": "scalar.unary",
    "kind": "accept",
    "value": "-21",
    "sha1": "b018b5b8238f708f744254b5d278fe074ac60d19",
    "source": "pub fnc main(): int { return -(7 * 3); }\n"
  },
  {
    "id": "scalar.i64-min",
    "kind": "accept",
    "value": "-9223372036854775808",
    "sha1": "450ebee951733d3f0b567413e70724155d26ce13",
    "source": "pub fnc main(): int { return -9223372036854775808; }\n"
  },
  {
    "id": "scalar.i64-max",
    "kind": "accept",
    "value": "9223372036854775807",
    "sha1": "8193f4d6a5969fe0a53f0d2700ceb576033b45e3",
    "source": "pub fnc main(): int { return 9223372036854775807; }\n"
  },
  {
    "id": "scalar.i64-max-minus-one",
    "kind": "accept",
    "value": "9223372036854775806",
    "sha1": "c400f440fde2fbc10514ab7cfd2ffe3d19729ee1",
    "source": "pub fnc main(): int { return 9223372036854775807 - 1; }\n"
  },
  {
    "id": "reject.unknown",
    "kind": "reject",
    "value": null,
    "sha1": "1c3ff45f58168c3f992c3666b7e216112b5fd64c",
    "source": "pub fnc main(): int { return undeclared_value; }\n"
  },
  {
    "id": "reject.division",
    "kind": "reject",
    "value": null,
    "sha1": "74d97f3fc4cb6e0765dbf5ef378e52d90cd7187b",
    "source": "pub fnc main(): int { return 3 / 2; }\n"
  },
  {
    "id": "reject.actor",
    "kind": "reject",
    "value": null,
    "sha1": "1ef9596b87dae01b99c0196bbc90795c857c02bd",
    "source": "define actor Worker as { pub fnc on_message(int n): int { return n; } }\npub fnc main(): int { const worker = spawn Worker(); stop worker; return 43; }\n"
  },
  {
    "id": "reject.async",
    "kind": "reject",
    "value": null,
    "sha1": "5ef809067332ab47cfacbc76fb2a287de865a01c",
    "source": "pub async fnc main(): int { return 42; }\n"
  },
  {
    "id": "reject.structural",
    "kind": "reject",
    "value": null,
    "sha1": "b889c7473344a6c058b824f35bad81938d198feb",
    "source": "pub fnc main(): int { return match 2 over on 2 { 42; } end; }\n"
  }
]);

function blobSha1(source) {
  const b = Buffer.from(source, 'utf8');
  return createHash('sha1').update('blob ' + b.length + '\0').update(b).digest('hex');
}
const compilerBytes = await readFile(new URL('../public/atto_compiler.wasm', import.meta.url));
const compiler = await createCompiler(compilerBytes);

test('shared scalar/v1 browser corpus is 11 exact pinned upstream inputs', () => {
  assert.match(EXPECTED_MANIFEST_BLOB, /^[a-f0-9]{40}$/);
  assert.equal(CASES.length, 11);
  assert.deepEqual(CASES.map(row=>row.id), [
    'scalar.literal-42','scalar.precedence','scalar.unary',
    'scalar.i64-min','scalar.i64-max','scalar.i64-max-minus-one',
    'reject.unknown','reject.division','reject.actor',
    'reject.async','reject.structural'
  ]);
  assert.equal(CASES.filter(row=>row.kind==='accept').length, 6);
  assert.equal(CASES.filter(row=>row.kind==='reject').length, 5);
  for (const row of CASES) {
    assert.equal(blobSha1(row.source),row.sha1,'canonical input drift: '+row.id);
    assert.ok(Buffer.byteLength(row.source) > 0 && Buffer.byteLength(row.source) <= 65536);
  }
});

for (const row of CASES) {
  test('real Rust wasm32 compiler: '+row.id, async () => {
    const compiled = compiler.compile(row.source);
    if (row.kind === 'reject') {
      // The reject.actor case is legacy scalar-profile syntax. This does NOT
      // imply the full browser compiler rejects its supported actor subset.
      assert.equal(compiled.ok,false,'unsupported scalar profile input must reject');
      assert.equal(Object.hasOwn(compiled,'wasm'),false,'no executable artifact on rejection');
      assert.match(compiled.diagnostics?.[0]?.message ?? '',/^E_[A-Z0-9_]+:/);
      assert.ok(compiled.diagnostics[0].line >= 1 && compiled.diagnostics[0].column >= 1);
      return;
    }
    assert.equal(compiled.ok,true,JSON.stringify(compiled.diagnostics));
    assert.ok(compiled.wasm instanceof Uint8Array && WebAssembly.validate(compiled.wasm));
    const module = await WebAssembly.compile(compiled.wasm);
    const output = {text:'',truncated:false};
    const {imports,bind} = guestImports(module,output);
    const guest = await WebAssembly.instantiate(module,imports);
    bind(guest);
    assert.equal(guest.exports.main(),BigInt(row.value),'exact signed i64 result');
    assert.equal(output.text,'','no unexpected stdout');
    assert.equal(output.truncated,false);
    const second=compiler.compile(row.source);
    assert.equal(second.ok,true,'repeat compile');
    assert.deepEqual(second.wasm,compiled.wasm,'deterministic guest binary');
  });
}

test('shared scalar errors do not poison the subsequent browser compile', () => {
  assert.equal(compiler.compile(CASES.find(x=>x.id==='reject.unknown').source).ok,false);
  const valid=compiler.compile(CASES.find(x=>x.id==='scalar.literal-42').source);
  assert.equal(valid.ok,true,'recovery after a semantic rejection');
});
