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

// A release candidate is not an arbitrary JSON file under a directory.
// Introduce future formats only by a reviewed change to this code and tests.
export const CANDIDATE_NAMES = Object.freeze([
  '2026-11-13-rust-wasm.json',
  '2026-11-13-rust-wasm-trap.json',
  '2026-11-13-trap-eh-rust-wasm.json'
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
          !['caller_trap','ordinary_throw','nested_option_result'].includes(k)) ||
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
  const compiler = await createCompiler(bytes);
  async function run(label, source, expectedValue, expectedOutput = '') {
    const compiled = compiler.compile(source);
    if (!compiled.ok) {
      throw new Error(`${label}: ${JSON.stringify(compiled.diagnostics)}`);
    }
    const guest = await WebAssembly.compile(compiled.wasm);
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
    const guest = await WebAssembly.compile(overflow.wasm);
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
