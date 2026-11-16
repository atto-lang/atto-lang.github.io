#!/usr/bin/env node
/** Read-only verification of a reviewed, separately built compiler candidate.
 * Do not copy into public/ or modify compiler-pin.js here: that requires an
 * independently approved public binary disclosure and reviewed source commit.
 *
 * Usage: node play/tools/verify-compiler-candidate.mjs /path/to/atto_compiler.wasm
 *        [2026-11-13-trap-eh-rust-wasm.json]
 * The candidate name is a local allowlisted receipt basename, not a URL.
 * The verified artifact stays private; this command performs NO publication.
 */
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createCompiler, verifyCompilerBytes, COMPILER_ABI } from '../src/compiler.js';
import { guestImports, describePanic } from '../src/guest.js';
import { admitWasm32Memory } from '../src/wasm-memory-admission.js';
import { requireGuestAbiV2 } from '../src/actor-abi-version.js';

// A release candidate is not an arbitrary JSON file under a directory.
// Introduce future formats only by a reviewed change to this code and tests.
export const CANDIDATE_NAMES = Object.freeze([
  '2026-11-13-rust-wasm.json',
  '2026-11-13-rust-wasm-trap.json',
  '2026-11-13-trap-eh-rust-wasm.json',
  '2026-11-15-callable-class-mtd-rust-wasm.json',
  '2026-11-15-lexical-pure-rust-wasm.json'
]);

/** Classify the two currently supported *unpublished* candidate contracts.
 * Never infer trap capability from the presence of a file or a nearby label.
 */
export function candidateProfile(receipt) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
    throw new Error('Invalid candidate receipt structure');
  }
  const feature = receipt.features;
  if (feature !== undefined) {
    if (!feature || typeof feature !== 'object' || Array.isArray(feature) ||
        Object.keys(feature).some(k =>
          !['caller_trap','ordinary_throw','nested_option_result','lexical_pure'].includes(k)) ||
        Object.values(feature).some(v => typeof v !== 'boolean')) {
      throw new Error('Unknown or malformed compiler feature claims');
    }
  }
  const typedProfile = receipt.verified_feature_profile;
  if (typedProfile !== undefined && typedProfile !== 'typed-ordinary-throw-trap') {
    throw new Error('Unknown compiler feature profile; refuse downgrade');
  }
  const fromFields = feature?.caller_trap === true;
  const fromTyped = typedProfile === 'typed-ordinary-throw-trap';
  if ((feature !== undefined && fromTyped && !fromFields) ||
      (fromFields && (feature.ordinary_throw !== true ||
                      feature.nested_option_result !== true)) ||
      (feature !== undefined && !fromFields &&
        (feature.ordinary_throw === true || feature.nested_option_result === true))) {
    throw new Error('Inconsistent caller-side trap provenance');
  }
  return fromFields || fromTyped ? 'typed-ordinary-throw-trap' : 'legacy-no-trap';
}

/** Apply exactly the production worker's Wasm32 memory guard *before* guest
 * compilation, including imported-memory, shared-memory and over-quota denial.
 * Candidate provenance is not a bypass of guest runtime admission.
 */
export function admitCandidateGuestWasm(wasm) {
  if (!(wasm instanceof Uint8Array) || wasm.byteLength > (1 << 20) ||
      !WebAssembly.validate(wasm)) {
    throw new Error('E_GUEST_ADMISSION: invalid or oversized compiler guest');
  }
  return admitWasm32Memory(wasm);
}

export async function verifyCandidate(path, options = {}) {
  // Accept verifyCandidate(path, '<receipt>.json') as well as {candidateName}.
  if (options === null || (typeof options !== 'object' && typeof options !== 'string') ||
      Array.isArray(options)) {
    throw new TypeError('Candidate selector must be a receipt name or options object');
  }
  const {candidateName = '2026-11-13-rust-wasm.json'} =
    typeof options === 'string' ? {candidateName: options} : options;
  if (typeof candidateName !== 'string' ||
      !CANDIDATE_NAMES.includes(candidateName)) {
    throw new TypeError('Unapproved candidate receipt name: explicit review allowlist required');
  }
  if (typeof path !== 'string' || !path || !path.endsWith('.wasm')) {
    throw new TypeError('Supply the explicit path to the reviewed compiler .wasm artifact');
  }
  const receipt = JSON.parse(await readFile(
    new URL('../release-candidates/' + candidateName, import.meta.url), 'utf8'));
  if (receipt.schema !== 'atto.browser.compiler.candidate.v1' ||
      receipt.status !== 'verified_candidate_unpublished' ||
      receipt.public_disclosure_approved !== false ||
      receipt.source_repository !== 'atto-lang/atto-source.rs' ||
      !/^[a-f0-9]{40}$/.test(receipt.source_head) ||
      !/^[a-f0-9]{40}$/.test(receipt.source_tree) ||
      receipt.compiler_abi !== COMPILER_ABI ||
      receipt.guest_abi !== 'atto.browser.guest.v2' ||
      !/^[a-f0-9]{64}$/.test(receipt.compiler_sha256) ||
      !Number.isSafeInteger(receipt.compiler_bytes) ||
      receipt.compiler_bytes <= 0 || receipt.compiler_bytes > 1024*1024 ||
      typeof receipt.target !== 'string' ||
      receipt.target !== 'wasm32-unknown-unknown' ||
      typeof receipt.toolchain !== 'string' ||
      !/^rustc 1\.85\.1(?:\s|$)/.test(receipt.toolchain) ||
      typeof receipt.carrier_repository !== 'string' ||
      !/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(receipt.carrier_repository) ||
      typeof receipt.carrier_run !== 'string' ||
      !receipt.carrier_run.startsWith('https://github.com/'+receipt.carrier_repository+'/actions/runs/') ||
      !Number.isSafeInteger(receipt.artifact_id) || receipt.artifact_id <= 0) {
    throw new Error('Unreviewed or malformed candidate provenance');
  }
  const profile = candidateProfile(receipt);
  const isLexicalPure = candidateName === '2026-11-15-lexical-pure-rust-wasm.json';
  // Feature names in metadata cannot activate a verifier profile without an
  // exact reviewed allowlisted receipt. Conversely, the reviewed candidate
  // may not silently omit the feature claim or its executed proof.
  if ((receipt.features?.lexical_pure === true) !== isLexicalPure ||
      (isLexicalPure && (
        receipt.compiler_import_count !== 0 ||
        receipt.conformance?.failed !== 0 ||
        !Number.isSafeInteger(receipt.conformance?.passed) ||
        receipt.conformance.passed < 381 ||
        !Number.isSafeInteger(receipt.conformance?.native_wasm_byte_compares) ||
        receipt.conformance.native_wasm_byte_compares < 344 ||
        receipt.conformance?.rust_native !== true ||
        receipt.conformance?.chromium_browser !== true ||
        receipt.conformance?.reproducible_clean_target !== true ||
        receipt.conformance?.actor_trace_passed !== 28 ||
        receipt.conformance?.required_compiler_exports_verified !== true ||
        receipt.conformance?.java_differential !== false ||
        !/^[a-f0-9]{64}$/.test(receipt.artifact_zip_sha256) ||
        receipt.source_validated_head !== receipt.source_head
      ))) {
    throw new Error('Lexical/pure candidate lacks reviewed executed provenance');
  }
  if (profile === 'typed-ordinary-throw-trap') {
    if (receipt.features?.caller_trap === true) {
      if (!/^[a-f0-9]{40}$/.test(receipt.source_validated_head) ||
          !/^[a-f0-9]{40}$/.test(receipt.carrier_head) ||
          !/^[a-f0-9]{64}$/.test(receipt.artifact_zip_sha256) ||
          receipt.conformance?.failed !== 0 ||
          receipt.conformance?.chromium_browser !== true) {
        throw new Error('Incomplete caller trap build provenance');
      }
    } else if (receipt.verified_feature_profile === 'typed-ordinary-throw-trap') {
      if (receipt.actor_memory_profile !==
          'bounded-private-wasm32-linear-memory-for-scalar-actors') {
        throw new Error('Missing verified private actor memory profile');
      }
    }
  }
  const bytes = await readFile(path);
  await verifyCompilerBytes(bytes, receipt.compiler_sha256, receipt.compiler_bytes);
  const module = await WebAssembly.compile(bytes);
  if (WebAssembly.Module.imports(module).length !== 0) {
    throw new Error('Candidate compiler requests host imports');
  }
  if (isLexicalPure) {
    const actualExports = new Set(WebAssembly.Module.exports(module).map(x => x.name));
    const requiredExports = [
      'memory', 'abi_version', 'input_ptr', 'input_capacity', 'compile',
      'result_ptr', 'result_length', 'error_ptr',
      'error_line_number', 'error_column_number'
    ];
    if (requiredExports.some(name => !actualExports.has(name))) {
      throw new Error('Lexical/pure compiler missing required source-CI ABI exports');
    }
  }
  const compiler = await createCompiler(bytes);
  async function run(label, source, expectedValue, expectedOutput = '') {
    const compiled = compiler.compile(source);
    if (!compiled.ok) {
      throw new Error(`${label}: ${JSON.stringify(compiled.diagnostics)}`);
    }
    admitCandidateGuestWasm(compiled.wasm);
    const guest = await WebAssembly.compile(compiled.wasm);
    requireGuestAbiV2(guest);
    const out = { text: '', truncated: false };
    const { imports, bind } = guestImports(guest, out);
    const instance = await WebAssembly.instantiate(guest, imports);
    bind(instance);
    let value;
    try { value = instance.exports.main(); }
    catch (error) { throw new Error(`${label}: ${describePanic(instance, error)}`); }
    if (value !== expectedValue || out.text !== expectedOutput || out.truncated) {
      throw new Error(`${label}: got ${value} / ${JSON.stringify(out.text)}, expected ${expectedValue} / ${JSON.stringify(expectedOutput)}`);
    }
    return { label, result: String(value), stdout: out.text };
  }

  const resultSource = await readFile(new URL('../examples/preview/result-option.atto', import.meta.url), 'utf8');
  const pipeSource = await readFile(new URL('../examples/preview/function-pipeline.atto', import.meta.url), 'utf8');
  const cases = [
    await run('result-option-current-dropdown', resultSource, 0n, '8080\n'),
    await run('functional-pipeline-current-dropdown', pipeSource, 121n, '121\n'),
    await run('typed-option-question-propagation', `fnc value(): Option<int> { return Some(5); }
fnc compute(): Option<int> { val x: int = value()?; return Some(x + 1); }
pub fnc main(): int {
  match compute() over
    on Some(n) -> { return n; }
    on None -> { return 0; }
  end
}`, 6n),
    await run('typed-result-question-error-return', `fnc failure(): Result<int,string> { return Err("bad"); }
fnc compute(): Result<int,string> {
  val n: int = failure()?;
  stdio.println("not reached");
  return Ok(n + 1);
}
pub fnc main(): int {
  match compute() over
    on Ok(n) -> { return n; }
    on Err(msg) -> { return 7; }
  end
}`, 7n)
  ];

  if (isLexicalPure) {
    const lexicalSource = await readFile(new URL('../examples/preview/lexical-scope-pure.atto', import.meta.url), 'utf8');
    cases.push(await run('lexical-pure-current-dropdown', lexicalSource,
      0n, '42\n42\n2\n42\n'));
    // Exercise the constructor-argument lexical-capture hardening through the
    // actual compiler Wasm and guest runtime, not a JS AST emulator. A global
    // function of the same name would return 2100 rather than 42.
    cases.push(await run('lexical-constructor-definition-site-capture', `
fnc transform(int n): int { return n * 100; }
define class Container as
  mut int value = 0;
  constructor(int v) { self.value = v; }
  pub get(): int { return self.value; }
end
pub fnc main(): int {
  val factor = 2;
  val transform = |n| : int -> n * factor;
  block {
    val factor = 100;
    val container = new Container(transform(21));
    return container.get();
  }
}
`, 42n));
    // Negative tests must reject *before* a guest module is returned.
    // This checks the exact compiler bytes rather than a JavaScript emulator.
    function reject(label, source, expected) {
      const compiled = compiler.compile(source);
      const diagnostics = compiled?.diagnostics;
      if (compiled?.ok || compiled?.wasm ||
          !Array.isArray(diagnostics) || diagnostics.length !== 1 ||
          !diagnostics[0]?.message?.startsWith(expected + ':')) {
        throw new Error(label + ' did not fail closed with ' + expected + ': ' + JSON.stringify(diagnostics));
      }
      cases.push({label, rejectedWith: expected});
    }
    reject('pure-stdio-forbidden',
      'pure fnc impure(): int { stdio.println(42); return 42; } pub fnc main(): int { return impure(); }', 'E_PURE');
    reject('pure-transitive-effect-forbidden',
      'fnc log(int x): int { stdio.println(x); return x; } pure fnc bad(int x): int { return log(x); } pub fnc main(): int { return bad(42); }', 'E_PURE');
    reject('pure-dead-branch-effect-forbidden',
      'pure fnc bad(): int { if false then stdio.println(1); fi return 42; } pub fnc main(): int { return bad(); }', 'E_PURE');
    reject('pure-heap-concat-forbidden',
      'pure fnc bad(string x): string { return x + "!"; } pub fnc main(): int { stdio.println(bad("x")); return 0; }', 'E_PURE');
    reject('mutable-closure-capture-forbidden',
      'pub fnc main(): int { let x = 2; val f = |n| : int -> n * x; return f(21); }', 'E_CAPTURE');
    reject('first-class-closure-escape-forbidden',
      'pub fnc main(): int { val f = |n| : int -> n + 1; val alias = f; return f(41); }', 'E_UNSUPPORTED');
    reject('out-of-scope-closure-capture-forbidden',
      'pub fnc main(): int { block { val x = 2; } val f = |n| : int -> n * x; return f(21); }', 'E_CAPTURE');
    reject('constructor-argument-first-class-lambda-escape-forbidden', `
define class Holder as
  mut int value = 0;
  constructor(int v) { self.value = v; }
end
pub fnc main(): int {
  val direct = |n| : int -> n + 1;
  val holder = new Holder(direct);
  return direct(41);
}`, 'E_UNSUPPORTED');
  }

  // Old candidates must keep failing closed. New candidates must prove
  // the actual guest exception boundary (not an AST preview or JS emulation).
  let trapProof;
  if (profile === 'typed-ordinary-throw-trap') {
    // A normal Result.Err remains a value under Some, never a trapped None.
    const checked = `fnc checked_id(int id): Result<int,string> {
  if id < 0 then return Err("invalid"); fi
  return Ok(id);
}
`;
    const inspect = `match trap checked_id(ARG) over
    on Some(inner) -> {
      match inner over
        on Ok(n) -> { return n; }
        on Err(msg) -> { stdio.println(msg); return 7; }
      end
    }
    on None -> { return 0; }
  end`;
    cases.push(await run('trap-some-ok', checked +
      'pub fnc main(): int {' + inspect.replace('ARG', '5') + '}', 5n));
    cases.push(await run('trap-some-err', checked +
      'pub fnc main(): int {' + inspect.replace('ARG', '-1') + '}', 7n, 'invalid\n'));
    cases.push(await run('ordinary-throw-across-calls',
      `fnc fail(): int { throw Error("guest"); }
fnc middle(): int { return fail(); }
pub fnc main(): int {
  match trap middle() over
    on Some(n) -> { return n; }
    on None -> { return 9; }
  end
}`, 9n));
    const overflow = compiler.compile(`pub fnc main(): int {
  val x: int = 9223372036854775807;
  match trap (x + 1) over
    on Some(n) -> { return n; }
    on None -> { return 0; }
  end
}`);
    if (!overflow.ok) throw new Error('trap-panic-bypass did not compile');
    admitCandidateGuestWasm(overflow.wasm);
    const guest = await WebAssembly.compile(overflow.wasm);
    requireGuestAbiV2(guest);
    const out = { text: '', truncated: false };
    const { imports, bind } = guestImports(guest, out);
    const instance = await WebAssembly.instantiate(guest, imports);
    bind(instance);
    let panicked = false;
    try { instance.exports.main(); }
    catch (error) {
      if (!/E_PANIC: integer overflow/.test(describePanic(instance, error))) throw error;
      panicked = true;
    }
    if (!panicked) throw new Error('trap incorrectly recovered a checked arithmetic panic');
    trapProof = 'guest Error trapped, Result.Err preserved, panic escaped';
  } else {
    const unsupportedTrap = compiler.compile(`fnc checked_id(int id): int { return id; }
pub fnc main(): int { return trap checked_id(5); }`);
    if (unsupportedTrap.ok ||
        !unsupportedTrap.diagnostics?.[0]?.message?.startsWith('E_UNSUPPORTED:')) {
      throw new Error('Legacy candidate unexpectedly admits caller-side trap');
    }
    trapProof = unsupportedTrap.diagnostics[0].message;
  }
  if (candidateName === '2026-11-15-callable-class-mtd-rust-wasm.json') {
    // Private, independently reviewed candidate: provenance alone is never
    // public release approval or permission to expose these bytes.
    if (receipt.source_head !== 'd06f76c3c5567b66168365caed11150ed6c95a3d' ||
        receipt.source_tree !== '801633e32c525fb15d2aa362e98aa3be97e92472' ||
        receipt.carrier_repository !== 'honeypot-r-us-test/hnpt-e2e' ||
        receipt.artifact_id !== 14182945347 ||
        receipt.compiler_sha256 !== '74c7c6992a3470aab649da99ca0c0312cd2ee9cb1f0a6811c9b6a0f3e3021250' ||
        receipt.compiler_bytes !== 497331 ||
        receipt.conformance?.passed !== 361 ||
        receipt.conformance?.native_wasm_differential !== 324 ||
        receipt.conformance?.chromium_browser !== true ||
        receipt.public_disclosure_approved !== false) {
      throw new Error('Callable receiver candidate provenance is not the reviewed private build');
    }
    const fixtureDir = new URL('../release-candidates/fixtures/', import.meta.url);
    for (const [name,expected] of [
      ['172-erlang-callable-bodies.atto',30n],
      ['173-erlang-class-mtd.atto',25n],
    ]) {
      const source = await readFile(new URL(name, fixtureDir), 'utf8');
      cases.push(await run('verified-' + name, source, expected));
    }
    // Actor mtd must continue to fail closed while the class methods execute.
    const actorMtd = compiler.compile(
      'declare actor A; mtd (self: A) foo() -> int :: 5 end ' +
      'pub fnc main(): int { return 0; }');
    if (actorMtd.ok ||
        !actorMtd.diagnostics?.[0]?.message?.startsWith('E_UNSUPPORTED:')) {
      throw new Error('Candidate unexpectedly enabled unreviewed actor mtd dispatch');
    }
  }

  return {
    sourceHead: receipt.source_head,
    sourceTree: receipt.source_tree,
    compilerSha256: createHash('sha256').update(bytes).digest('hex'),
    compilerBytes: bytes.length,
    checks: cases,
    trapProof,
    featureProfile: profile,
    published: false
  };
}

if (process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href) {
  verifyCandidate(process.argv[2], {candidateName: process.argv[3]})
    .then(report => console.log(JSON.stringify(report, null, 2)))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
