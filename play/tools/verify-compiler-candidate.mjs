#!/usr/bin/env node
/** Read-only verification of a reviewed, separately built compiler candidate.
 * Do not copy into public/ or modify compiler-pin.js here: that requires an
 * independently approved public binary disclosure and reviewed source commit.
 *
 * Usage: node play/tools/verify-compiler-candidate.mjs /path/to/atto_compiler.wasm [approved-receipt-basename]
 */
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createCompiler, verifyCompilerBytes, COMPILER_ABI } from '../src/compiler.js';
import { guestImports, describePanic } from '../src/guest.js';

export async function verifyCandidate(path, receiptName = '2026-11-13-rust-wasm.json') {
  if (typeof path !== 'string' || !path || !path.endsWith('.wasm')) {
    throw new TypeError('Supply the explicit path to the reviewed compiler .wasm artifact');
  }
  const profiles = new Map([
    ['2026-11-13-rust-wasm.json', 'legacy-no-throw'],
    ['2026-11-13-rust-wasm-trap.json', 'typed-ordinary-throw-trap']
  ]);
  if (!profiles.has(receiptName)) {
    throw new Error('Unapproved candidate receipt name');
  }
  const profile = profiles.get(receiptName);
  const receipt = JSON.parse(await readFile(
    new URL('../release-candidates/' + receiptName, import.meta.url), 'utf8'));
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
      (profile === 'typed-ordinary-throw-trap' &&
        receipt.verified_feature_profile !== 'typed-ordinary-throw-trap')) {
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

  let trapResult;
  if (profile === 'typed-ordinary-throw-trap') {
    const trapSource = await readFile(new URL('../examples/preview/trap.atto', import.meta.url), 'utf8');
    cases.push(await run('trap-current-dropdown', trapSource, 7n, '5\nid must be nonnegative\n'));
    cases.push(await run('ordinary-throw-caught-as-none', `fnc fail(): int {
  throw Error("ordinary failure");
}
pub fnc main(): int {
  val Option<int> outcome = trap fail();
  match outcome over
    on Some(value) -> { return value; }
    on None -> { return 9; }
  end
}`, 9n));
    // Do not allow a language panic to be reported as an ordinary thrown Error.
    const panicSource = `pub fnc main(): int {
  val x: int = 9223372036854775807;
  val Option<int> outcome = trap (x + 1);
  match outcome over
    on Some(value) -> { return value; }
    on None -> { return 0; }
  end
}`;
    const panicGuest = compiler.compile(panicSource);
    if (!panicGuest.ok) throw new Error('panic-bypass compile failed: ' + JSON.stringify(panicGuest.diagnostics));
    const panicModule = await WebAssembly.compile(panicGuest.wasm);
    const out = { text: '', truncated: false };
    const { imports, bind } = guestImports(panicModule, out);
    const instance = await WebAssembly.instantiate(panicModule, imports);
    bind(instance);
    try {
      instance.exports.main();
      throw new Error('PANIC_NOT_RAISED: checked overflow was captured by trap');
    } catch (error) {
      if (error?.message?.startsWith('PANIC_NOT_RAISED:') ||
          describePanic(instance, error) !== 'E_PANIC: integer overflow') {
        throw new Error('trap must not swallow checked arithmetic panic: ' + error?.message);
      }
    }
    trapResult = 'ordinary Error -> None; Result Err remains data; panic bypasses trap';
  } else {
    const unsupportedTrap = compiler.compile(`fnc checked_id(int id): int { return id; }
pub fnc main(): int { return trap checked_id(5); }`);
    if (unsupportedTrap.ok || !unsupportedTrap.diagnostics?.[0]?.message?.startsWith('E_UNSUPPORTED:')) {
      throw new Error('legacy compiler unexpectedly admitted trap');
    }
    trapResult = unsupportedTrap.diagnostics[0].message;
  }
  return {
    sourceHead: receipt.source_head,
    sourceTree: receipt.source_tree,
    compilerSha256: createHash('sha256').update(bytes).digest('hex'),
    compilerBytes: bytes.length,
    checks: cases,
    trapMode: profile,
    trapResult,
    published: false
  };
}

if (process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href) {
  verifyCandidate(process.argv[2], process.argv[3])
    .then(report => console.log(JSON.stringify(report, null, 2)))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
