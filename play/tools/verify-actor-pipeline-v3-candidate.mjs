#!/usr/bin/env node
/**
 * Read-only production-host gate for a separately built Atto compiler.
 * Usage: node play/tools/verify-actor-pipeline-v3-candidate.mjs /path/to/atto_compiler.wasm
 *
 * This does not vendor/publish bytes, change a compiler pin, approve a
 * release, interpret Atto source in JS, or claim native backend parity.
 */
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createCompiler, verifyCompilerBytes } from '../src/compiler.js';
import { createActorHost } from '../src/actor-host.js';
import { actorNames, guestImports, pipeGuestAbi } from '../src/guest.js';

export async function verifyActorPipelineCandidate(candidatePath) {
  if (typeof candidatePath !== 'string' || !candidatePath.endsWith('.wasm')) {
    throw new TypeError('Provide the explicit path to the private compiler .wasm');
  }
  const receipt = JSON.parse(await readFile(
    new URL('../release-candidates/2026-11-13-actor-pipeline-v3-rust-wasm.json', import.meta.url),
    'utf8',
  ));
  if (receipt.schema !== 'atto.browser.compiler.candidate.v1' ||
      receipt.status !== 'verified_candidate_unpublished' ||
      receipt.public_disclosure_approved !== false ||
      receipt.source_repository !== 'atto-lang/atto-source.rs' ||
      receipt.source_tree !== receipt.carrier_tree ||
      receipt.compiler_abi !== 2 ||
      receipt.compiler_import_count !== 0 ||
      receipt.features?.actor_pipeline_v3 !== true ||
      receipt.features.actor_pipeline_emit_typecheck !== true ||
      receipt.features.actor_pipeline_bool_emit !== true ||
      receipt.conformance?.failed !== 0 ||
      receipt.conformance?.chromium_browser !== true ||
      !/^[a-f0-9]{40}$/.test(receipt.source_head) ||
      !/^[a-f0-9]{40}$/.test(receipt.source_tree) ||
      !/^[a-f0-9]{40}$/.test(receipt.carrier_head) ||
      !/^[a-f0-9]{64}$/.test(receipt.compiler_sha256)) {
    throw new Error('Incomplete/unauthorized actor pipeline candidate provenance');
  }

  const bytes = await readFile(candidatePath);
  await verifyCompilerBytes(bytes, receipt.compiler_sha256, receipt.compiler_bytes);
  const compilerModule = new WebAssembly.Module(bytes);
  if (WebAssembly.Module.imports(compilerModule).length !== 0) {
    throw new Error('Compiler unexpectedly imports host capabilities');
  }
  const compiler = await createCompiler(bytes);
  const actorDefs = (payload = 'int') => [
    'define actor Parse as',
    '  receive(ActorMail<int> mail): void {',
    payload === 'bool' ? '    emit(mail.value > 0);' : '    emit(mail.value + 1);',
    '    return;',
    '  }',
    'end',
    'define actor Validate as',
    '  receive(ActorMail<' + payload + '> mail): void {',
    payload === 'bool' ? '    if mail.value then emit(mail.value); fi' :
      '    if mail.value > 0 then emit(mail.value); fi',
    '    return;',
    '  }',
    'end',
    'define actor Sink as',
    '  receive(ActorMail<' + payload + '> mail): void {',
    '    stdio.println(mail.value);',
    '    return;',
    '  }',
    'end',
  ].join('\n') + '\n';

  async function runCase(label, source, expected, count) {
    const built = compiler.compile(source);
    if (!built.ok) throw new Error(label + ' compile: ' + JSON.stringify(built.diagnostics));
    const module = await WebAssembly.compile(built.wasm);
    if (!pipeGuestAbi(module)) throw new Error(label + ': v3 guest marker missing');
    const out = { text: '', truncated: false };
    const host = createActorHost({ module, names: actorNames(module), out });
    try {
      const { imports, bind } = guestImports(module, out, host);
      const main = await WebAssembly.instantiate(module, imports);
      bind(main);
      const value = main.exports.main();
      const fault = await host.drain();
      if (fault !== null || value !== 0n || out.text !== expected || out.truncated ||
          host.count !== count || host.memoryBytes < count * 65536) {
        throw new Error(label + ': wrong genuine Wasm guest result: ' + JSON.stringify({
          fault, value: String(value), stdout: out.text,
          actorCount: host.count, memoryBytes: host.memoryBytes,
        }));
      }
      return { label, stdout: out.text, actorCount: count, guestBytes: built.wasm.byteLength };
    } finally {
      host.close();
      if (host.memoryBytes !== 0) throw new Error(label + ': actor memory survived close');
    }
  }

  const intSource = actorDefs() + [
    'pub fnc main(): int {',
    '  val a = spawn Parse() | spawn Validate() | spawn Sink();',
    '  val b = spawn Parse() pipe spawn Validate() pipe spawn Sink();',
    '  a.send(41);',
    '  b.send(41);',
    '  return 0;',
    '}',
  ].join('\n');
  const boolSource = actorDefs('bool') + [
    'pub fnc main(): int {',
    '  val a = spawn Parse() pipe spawn Validate() | spawn Sink();',
    '  a.send(41);',
    '  return 0;',
    '}',
  ].join('\n');

  const checks = [
    await runCase('two independent actor chains', intSource, '42\n42\n', 6),
    await runCase('int-to-bool emitted mail', boolSource, 'true\n', 3),
  ];
  const wrong = compiler.compile(intSource.replace('emit(mail.value + 1);', 'emit(true);'));
  if (wrong.ok || !wrong.diagnostics?.[0]?.message?.startsWith('E_TYPE:')) {
    throw new Error('Type mismatch generated guest Wasm');
  }
  const unbound = compiler.compile('pub fnc main(): int { emit(42); return 0; }');
  if (unbound.ok || !unbound.diagnostics?.[0]?.message?.startsWith('E_UNSUPPORTED:')) {
    throw new Error('Top-level emit generated guest Wasm');
  }

  return {
    candidate: receipt.source_head,
    sourceTree: receipt.source_tree,
    compilerSha256: createHash('sha256').update(bytes).digest('hex'),
    checks,
    published: false,
  };
}

if (process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href) {
  verifyActorPipelineCandidate(process.argv[2])
    .then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
