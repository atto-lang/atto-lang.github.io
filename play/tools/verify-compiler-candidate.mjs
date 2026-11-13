#!/usr/bin/env node
/** Read-only verification of a reviewed, separately built compiler candidate.
 * Do not copy into public/ or modify compiler-pin.js here: that requires an
 * independently approved public binary disclosure and reviewed source commit.
 *
 * Usage: node play/tools/verify-compiler-candidate.mjs /path/to/atto_compiler.wasm
 */
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createCompiler, verifyCompilerBytes, COMPILER_ABI } from '../src/compiler.js';
import { guestImports, describePanic } from '../src/guest.js';

export async function verifyCandidate(path) {
  if (typeof path !== 'string' || !path || !path.endsWith('.wasm')) {
    throw new TypeError('Supply the explicit path to the reviewed compiler .wasm artifact');
  }
  const receipt = JSON.parse(await readFile(
    new URL('../release-candidates/2026-11-13-rust-wasm.json', import.meta.url), 'utf8'));
  if (receipt.schema !== 'atto.browser.compiler.candidate.v1' ||
      receipt.status !== 'verified_candidate_unpublished' ||
      receipt.public_disclosure_approved !== false ||
      receipt.source_repository !== 'atto-lang/atto-source.rs' ||
      !/^[a-f0-9]{40}$/.test(receipt.source_head) ||
      !/^[a-f0-9]{40}$/.test(receipt.source_tree) ||
      receipt.compiler_abi !== COMPILER_ABI ||
      receipt.guest_abi !== 'atto.browser.guest.v2' ||
      !/^[a-f0-9]{64}$/.test(receipt.compiler_sha256) ||
      !Number.isSafeInteger(receipt.compiler_bytes)) {
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

  const unsupportedTrap = compiler.compile(`fnc checked_id(int id): int { return id; }
pub fnc main(): int { return trap checked_id(5); }`);
  if (unsupportedTrap.ok || !unsupportedTrap.diagnostics?.[0]?.message?.startsWith('E_UNSUPPORTED:')) {
    throw new Error('trap must reject until throwable effect handling is truly implemented');
  }
  return {
    sourceHead: receipt.source_head,
    sourceTree: receipt.source_tree,
    compilerSha256: createHash('sha256').update(bytes).digest('hex'),
    compilerBytes: bytes.length,
    checks: cases,
    unsupportedTrap: unsupportedTrap.diagnostics[0].message,
    published: false
  };
}

if (process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href) {
  verifyCandidate(process.argv[2])
    .then(report => console.log(JSON.stringify(report, null, 2)))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
