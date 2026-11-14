// The current vendored browser compiler is independent of Java/LLVM/.NET.
// This tests the REAL pinned Rust->Wasm compiler; it cannot count a formatter
// round trip or a JS parser as compiled AttoLang guest parity.
import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {createCompiler, COMPILER_ABI} from "../src/compiler.js";

const bytes = await readFile(new URL("../public/atto_compiler.wasm", import.meta.url));
const receipt = JSON.parse(await readFile(
  new URL("../public/atto_compiler.receipt.json", import.meta.url), "utf8"));
const compiler = await createCompiler(bytes);

const knownBraced = "pub fnc main(): int { return 42; }\n";
const pending = Object.freeze([
  ["fnc-comma", "pub fnc main() -> int :: int x = 5, x + 37 end\n"],
  ["typed-inline", "pub fnc main(): int { val cb = || => int -> 5; return cb(); }\n"],
  ["typed-inline-parenthesized", "pub fnc main(): int { val cb = || (=> int) -> 5; return cb(); }\n"],
  ["typed-inline-comma", "pub fnc main(): int { val cb = || => int -> val int x = 5, x + 3; return cb(); }\n"],
  ["typed-comma-lambda", "pub fnc main(): int { val cb = || -> int :: int x = 5, x + 3 end; return cb(); }\n"],
  ["tuple-lambda-pipe", "pub fnc main(): int { return tuple(5, 6) |> |x, y| => int -> x + y; }\n"],
  ["reversed-inline-annotation", "pub fnc main(): int { val cb = || -> int => 5; return cb(); }\n"]
]);

function checkRejection(label, source) {
  const result = compiler.compile(source);
  assert.equal(result.ok, false,
    label + ": current pinned compiler must not pretend unsupported parity");
  assert.equal(Object.hasOwn(result, "wasm"), false,
    label + ": rejected syntax must not publish executable Wasm");
  assert.match(result.diagnostics?.[0]?.message ?? "", /^E_[A-Z0-9_]+:/,
    label + ": deterministic compiler-owned rejection required");
  assert.ok(result.diagnostics?.[0]?.line >= 1);
  assert.ok(result.diagnostics?.[0]?.column >= 1);
}

test("browser lambda syntax gate uses authenticated real compiler artifact", () => {
  assert.equal(compiler.abiVersion, undefined, "do not introduce JS compilation");
  assert.equal(COMPILER_ABI, receipt.compiler_abi);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), receipt.compiler_sha256);
  assert.equal(bytes.length, receipt.compiler_bytes);
});

test("pending comma-expression and typed-lambda forms fail closed in browser compiler", () => {
  for (const [label, source] of pending) checkRejection(label, source);
});

test("rejected modern syntax does not poison the actual compiler", () => {
  for (const [label, source] of pending) {
    checkRejection(label, source);
    const known = compiler.compile(knownBraced);
    assert.equal(known.ok, true, label + ": a prior rejection corrupted compiler state");
    assert.equal(WebAssembly.validate(known.wasm), true);
    const mod = new WebAssembly.Module(known.wasm);
    assert.deepEqual(WebAssembly.Module.imports(mod), []);
    assert.equal(BigInt(new WebAssembly.Instance(mod).exports.main()), 42n);
  }
});
