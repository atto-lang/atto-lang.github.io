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
// Admitted since atto-source.rs c633301 (end-style bodies, typed inline lambdas).
const admitted = Object.freeze([
  ["fnc-comma", "pub fnc main() -> int :: int x = 5, x + 37 end\n", 42n],
  ["typed-inline", "pub fnc main(): int { val op = || => int -> 5; return op(); }\n", 5n]
]);
// `cb` became reserved; use `op` so each form is rejected for its own syntax.
const pending = Object.freeze([
  ["typed-inline-parenthesized", "pub fnc main(): int { val op = || (=> int) -> 5; return op(); }\n"],
  ["typed-inline-comma", "pub fnc main(): int { val op = || => int -> val int x = 5, x + 3; return op(); }\n"],
  ["typed-comma-lambda", "pub fnc main(): int { val op = || -> int :: int x = 5, x + 3 end; return op(); }\n"],
  ["tuple-lambda-pipe", "pub fnc main(): int { return tuple(5, 6) |> |x, y| => int -> x + y; }\n"],
  ["reversed-inline-annotation", "pub fnc main(): int { val op = || -> int => 5; return op(); }\n"]
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

test("admitted comma-body and typed inline lambda forms execute exactly", () => {
  for (const [label, source, value] of admitted) {
    const result = compiler.compile(source);
    assert.equal(result.ok, true, label + ": " + JSON.stringify(result.diagnostics));
    const mod = new WebAssembly.Module(result.wasm);
    assert.deepEqual(WebAssembly.Module.imports(mod), []);
    assert.equal(BigInt(new WebAssembly.Instance(mod).exports.main()), value, label);
  }
});

test("closure and functor preview executes with the pinned browser compiler", async () => {
  const source = await readFile(new URL("../examples/preview/closures-functors.atto", import.meta.url), "utf8");
  const result = compiler.compile(source);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const mod = new WebAssembly.Module(result.wasm);
  assert.deepEqual(WebAssembly.Module.imports(mod), []);
  assert.equal(BigInt(new WebAssembly.Instance(mod).exports.main()), 84n);
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
