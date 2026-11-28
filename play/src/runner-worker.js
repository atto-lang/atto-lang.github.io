import { requireGuestAbiV2 } from './actor-abi-version.js';
/* Executes one guest module for ONE tenant in this worker.
 * All tenant actors are scheduled here, each in an independent Wasm instance.
 * The host's worker deadline enforces cancellation even for non-cooperative
 * guest loops. No actor worker is spawned and no extra imports are granted. */
import { actorNames, describePanic, guestImports, usesFloatPrint } from './guest.js';
import { createActorHost } from './actor-host.js';
import { admitWasm32Memory } from './wasm-memory-admission.js';
import { validateGuestImportABI } from './guest-import-abi.js';
import { pipeGuestAbi } from './guest.js';
import { createStateRuntime } from './state-runtime.js';
import { stateGuestProfile } from './state-guest-profile.js';
import { actorMailmanLane, createOresVM, taskGuestAbi } from './ores-vm.js';

// A disposable Worker is a single-use tenant execution boundary. Without
// this synchronous latch, two postMessage() calls can overlap across the
// async compile/instantiate/drain awaits and allocate two independent actor
// hosts, defeating the worker-wide 16-actor and memory admission limits.
// Never dereference the second payload or expose the first guest's output.
let acceptedOneGuest = false;
self.onmessage = async ({ data }) => {
  if (acceptedOneGuest) {
    self.postMessage({
      ok: false,
      message: 'E_TENANT_REUSE: disposable Worker already accepted a guest',
      stdout: '', truncated: false, actors: 0
    });
    return;
  }
  acceptedOneGuest = true;
  const out = { text: '', truncated: false };
  let host = null;
  let stateRuntime = null;
  let scheduler = null;
  const reply = message => self.postMessage({ ...message, stdout: out.text, truncated: out.truncated, actors: host?.count ?? 0,
    ...(scheduler ? { scheduler } : {}) });
  try {
    const source = data?.wasm;
    if (!(source instanceof Uint8Array) && !(source instanceof ArrayBuffer)) {
      throw new Error('E_GUEST_ABI: guest bytes required');
    }
    const view = source instanceof ArrayBuffer ? new Uint8Array(source) : source;
    if (!(view.buffer instanceof ArrayBuffer)) {
      throw new Error('E_GUEST_ABI: shared guest bytes not admitted');
    }
    if (view.byteLength > (1 << 20)) throw new Error('Invalid/oversized guest module');
    const wasm = new Uint8Array(view); // immutable snapshot for admission + compilation
    if (!WebAssembly.validate(wasm)) throw new Error('Invalid/oversized guest module');
    // Admission happens BEFORE compiling or instantiating guest code.
    admitWasm32Memory(wasm);
    const module = await WebAssembly.compile(wasm);
    requireGuestAbiV2(module);
    // A partial state import must never silently acquire an incomplete lease
    // lifecycle. Actor-state and pipeline-state guest protocols are separate.
    const names = actorNames(module);
    const pipeline = pipeGuestAbi(module);
    const needsState = stateGuestProfile(module, { actorTypes: names.length, pipeline });
    // print_f64 is a pure output hook; its exact (f64) -> () signature is
    // enforced from the binary import section, never inferred from names.
    validateGuestImportABI(wasm, module, { allowFloat: usesFloatPrint(module), allowPipeline: pipeline, allowState: needsState });
    if (needsState) stateRuntime = createStateRuntime({
      maxContainers: 1024, maxTickets: 1024, requireBoundMemory: true
    });
    if (names.length) host = createActorHost({ module, names, out });
    const { imports, bind } = guestImports(module, out, host, null, { state: stateRuntime });
    const instance = await WebAssembly.instantiate(module, imports);
    bind(instance);
    // A supervisor-owned CONTROL/completion channel (optional). Only a
    // SharedArrayBuffer is admitted; it never carries guest bytes.
    // Non-isolated browser realms have no SharedArrayBuffer global at all.
    const channel = typeof SharedArrayBuffer === 'function' && data?.channel instanceof SharedArrayBuffer ? data.channel : null;
    let result;
    try {
      // atto.task.v1: a susp main runs on the OresVM. This Worker becomes the
      // carrier (synchronous loop, Atomics.wait parking) when shared memory
      // is available; otherwise the explicit event-loop driver runs it.
      if (taskGuestAbi(module)) {
        const vm = createOresVM({ instance, lanes: host ? [actorMailmanLane(host)] : [], scheduler: 'auto', channel });
        scheduler = vm.mode;
        result = (vm.mode === 'carrier' ? vm.runSync() : await vm.run()).value;
      } else {
        result = instance.exports.main();
      }
    } catch (error) {
      stateRuntime?.abort();
      host?.close();
      reply({ ok: false, message: describePanic(instance, error) });
      return;
    }
    if (typeof result !== 'bigint') throw new Error('Guest returned unexpected value');
    // A successful guest must return with *all* critical tickets released.
    // Registering a container is not a leaked capability: complete retires it.
    stateRuntime?.complete();
    // main has returned: wait until every actor has handled all of its mail
    const fault = host ? await host.drain() : null;
    host?.close();
    if (fault) reply({ ok: false, message: fault, value: result.toString() });
    else reply({ ok: true, value: result.toString() });
  } catch (error) {
    stateRuntime?.abort();
    host?.close();
    reply({ ok: false, message: /^E_[A-Z_]+: /.test(error?.message ?? '') ? error.message : `E_RUNTIME: ${error.message}` });
  }
};
