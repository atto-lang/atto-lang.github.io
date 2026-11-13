import { admitWasm32Memory } from './wasm-memory-admission.js';
import { requireGuestAbiV2 } from './actor-abi-version.js';
/* One AttoLang actor: a private instance of the program's guest module.
 * Messages are handled strictly in order; init compiles the module, runs
 * actor_init(type), then each mail calls actor_receive(type, value, sequence).
 * An actor cannot spawn or send (the compiler rejects it; the host denies it).
 * After a fault the actor stops: remaining mail is not delivered. */
import { describePanic, guestImports } from './guest.js';

// print imports write into this one object; it is reset per message
const out = { text: '', truncated: false };
let instance = null, type = -1, failed = false;
let chain = Promise.resolve();

self.onmessage = ({ data }) => { chain = chain.then(() => handle(data)); };

async function handle(data) {
  if (failed) return;
  try {
    if (data?.kind === 'init' && !instance) {
      const wasm = data.wasm;
      if (!(wasm instanceof Uint8Array) || wasm.byteLength > 1 << 20 || !WebAssembly.validate(wasm)) throw new Error('Invalid/oversized guest module');
      if (!Number.isInteger(data.type) || data.type < 0) throw new Error('Invalid actor type');
      admitWasm32Memory(wasm);
      const module = await WebAssembly.compile(wasm);
      requireGuestAbiV2(module);
      const host = guestImports(module, out);
      const created = await WebAssembly.instantiate(module, host.imports);
      host.bind(created);
      if (typeof created.exports.actor_init !== 'function' || typeof created.exports.actor_receive !== 'function') {
        throw new Error('Guest actor exports missing');
      }
      instance = created;
      type = data.type;
      instance.exports.actor_init(type);
      self.postMessage({ kind: 'ready' });
    } else if (data?.kind === 'mail' && instance) {
      if (typeof data.value !== 'bigint' || !Number.isSafeInteger(data.sequence)) throw new Error('Invalid mail');
      out.text = '';
      out.truncated = false;
      instance.exports.actor_receive(type, data.value, BigInt(data.sequence));
      self.postMessage({ kind: 'done', sequence: data.sequence, stdout: out.text, truncated: out.truncated });
    } else {
      throw new Error('Actor protocol violation');
    }
  } catch (error) {
    failed = true;
    const message = instance ? describePanic(instance, error) : `E_RUNTIME: ${error.message}`;
    self.postMessage({ kind: 'fault', message, stdout: out.text, truncated: out.truncated });
  }
}

