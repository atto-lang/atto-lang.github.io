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

export async function verifyCandidate(path, {candidateName = '2026-11-13-rust-wasm.json'} = {}) {
  if (typeof candidateName !== 'string' ||
      !/^[0-9]{4}-[0-9]{2}-[0-9]{2}-[a-z0-9-]+\.json$/.test(candidateName)) {
    throw new TypeError('Candidate receipt must be a local release-candidates JSON basename');
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
      (receipt.features !== undefined &&
        (typeof receipt.features !== 'object' || receipt.features === null))) {
    throw new Error('Unreviewed or malformed candidate provenance');
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
  if (receipt.features?.caller_trap === true) {
    if (receipt.features.ordinary_throw !== true ||
        receipt.features.nested_option_result !== true ||
        !/^[a-f0-9]{40}$/.test(receipt.source_validated_head) ||
        !/^[a-f0-9]{40}$/.test(receipt.carrier_head) ||
        !/^[a-f0-9]{64}$/.test(receipt.artifact_zip_sha256) ||
        receipt.conformance?.failed !== 0 ||
        receipt.conformance?.chromium_browser !== true) {
      throw new Error('Caller trap candidate has incomplete verifiable provenance');
    }
    // A normal Result.Err remains a value under Some, never a trapped None.
    const checked = `fnc checked_id(int id): Result<int,string> {
  if id < 0 then return Err("invalid"); fi
  return Ok(id);
}`;
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
      'pub fnc main(): int {' + inspect.replace('ARG', '-1') + '}', 7n, 'invalid\\n'));
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
    published: false
  };
}

if (process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href) {
  verifyCandidate(process.argv[2], {candidateName: process.argv[3]})
    .then(report => console.log(JSON.stringify(report, null, 2)))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
