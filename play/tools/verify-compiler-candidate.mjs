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
  '2026-11-13-trap-eh-rust-wasm.json',
  '2026-11-15-ownership-rust-wasm.json'
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
  if (typedProfile !== undefined &&
      !['typed-ordinary-throw-trap', 'explicit-ownership-bang-v1'].includes(typedProfile)) {
    throw new Error('Unknown compiler feature profile; refuse downgrade');
  }
  if (typedProfile === 'explicit-ownership-bang-v1') {
    if (feature !== undefined) {
      throw new Error('Ownership candidate must not claim unverified trap features');
    }
    return 'explicit-ownership-bang-v1';
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
  if (profile === 'explicit-ownership-bang-v1') {
    const proof = receipt.ownership_proof;
    if (receipt.source_validated_head !== receipt.source_head ||
        !/^[a-f0-9]{40}$/.test(receipt.carrier_head) ||
        !/^[a-f0-9]{64}$/.test(receipt.artifact_zip_sha256) ||
        !Number.isSafeInteger(receipt.carrier_job_id) ||
        receipt.carrier_job_id <= 0 ||
        receipt.compiler_import_count !== 0 ||
        receipt.conformance?.passed < 389 ||
        receipt.conformance?.failed !== 0 ||
        receipt.conformance?.native_wasm_byte_compares < 352 ||
        receipt.conformance?.chromium_browser !== true ||
        proof?.exact_source_blob_count !== 408 ||
        proof?.positive_guest_cases !== 3 ||
        proof?.negative_no_artifact_cases !== 27 ||
        JSON.stringify(proof.canonical_syntax) !== JSON.stringify([
          'borrow! owner','borrow! mut owner','copy! value',
          'take! owner','share! value'
        ])) {
      throw new Error('Incomplete exact-tree ownership candidate proof');
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

  // Confirm the approved private candidate can execute the very preview that
  // remains disabled against the older pinned PUBLIC compiler. This read-only
  // verifier does not alter browser assets, digest pins, or release metadata.
  let ownershipProof;
  if (profile === 'explicit-ownership-bang-v1') {
    const preview = await readFile(
      new URL('../examples/preview/borrow-checking.atto', import.meta.url), 'utf8');
    cases.push(await run('ownership-current-playground-preview', preview, 63n, '84\n43\n'));
    const parcel = `define class Parcel as
  pub let int value = 42;
end
`;
    const negatives = [
      ['exclusive-conflict', parcel + `pub fnc main(): int {
        let p = new Parcel(); val r = borrow! p;
        val w = borrow! mut p; return r.value + w.value;
      }`, 'E_BORROW'],
      ['moved-owner', parcel + `pub fnc main(): int {
        let p = new Parcel(); val moved = take! p;
        return p.value + moved.value;
      }`, 'E_MOVED'],
      ['noncopy-class', parcel + `pub fnc main(): int {
        val p = new Parcel(); val c = copy! p; return c.value;
      }`, 'E_COPY'],
      ['nonshare-class', parcel + `pub fnc main(): int {
        val p = new Parcel(); val s = share! p; return s.value;
      }`, 'E_SHARE'],
      ['old-mutable-operator', parcel + `pub fnc main(): int {
        val p = new Parcel(); val w = borrow_mut! p; return w.value;
      }`, 'E_SYNTAX'],
      ['scalar-mut-loan', `pub fnc main(): int {
        let x = 42; val w = borrow! mut x; return w;
      }`, 'E_BORROW']
    ];
    for (const [label, source, expected] of negatives) {
      const rejected = compiler.compile(source);
      if (rejected.ok || rejected.wasm?.byteLength > 0 ||
          !rejected.diagnostics?.[0]?.message?.startsWith(expected + ':')) {
        throw new Error(`ownership ${label}: expected fail-closed ${expected}, got ${JSON.stringify(rejected.diagnostics)}`);
      }
    }
    ownershipProof = 'real preview guest 63 / 84,43 and six no-artifact compiler rejections';
  }

  // Legacy and trap-specific candidates retain their separate guarantees.
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
  } else if (profile === 'legacy-no-trap') {
    const unsupportedTrap = compiler.compile(`fnc checked_id(int id): int { return id; }
pub fnc main(): int { return trap checked_id(5); }`);
    if (unsupportedTrap.ok ||
        !unsupportedTrap.diagnostics?.[0]?.message?.startsWith('E_UNSUPPORTED:')) {
      throw new Error('Legacy candidate unexpectedly admits caller-side trap');
    }
    trapProof = unsupportedTrap.diagnostics[0].message;
  } else {
    trapProof = 'not assessed by the ownership-specific verification profile';
  }
  return {
    sourceHead: receipt.source_head,
    sourceTree: receipt.source_tree,
    compilerSha256: createHash('sha256').update(bytes).digest('hex'),
    compilerBytes: bytes.length,
    checks: cases,
    trapProof,
    ownershipProof,
    featureProfile: profile,
    published: false
  };
}

if (process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href) {
  verifyCandidate(process.argv[2], {candidateName: process.argv[3]})
    .then(report => console.log(JSON.stringify(report, null, 2)))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
