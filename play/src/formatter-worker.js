import { FORMATTER_SHA256, FORMATTER_BYTES } from './formatter-pin.js';
import { formatWithWasm } from './formatter-runtime.js';
// One disposable worker per request. Source never leaves the browser.
self.onmessage = async event => {
  try {
    const source = event.data?.source;
    if (typeof source !== 'string') throw new Error('Source is not text');
    if (new TextEncoder().encode(source).length > 65536) throw new Error('E_FORMAT_LIMIT: input exceeds 64 KiB');
    const response=await fetch(new URL('../public/oreslang_format.wasm',import.meta.url),{cache:'no-store'});
    if(!response.ok) throw new Error('Formatter module failed to load');
    const bytes=new Uint8Array(await response.arrayBuffer());
    if(bytes.length !== FORMATTER_BYTES) throw new Error('Formatter module length differs from approved binary');
    const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),
      n=>n.toString(16).padStart(2,'0')).join('');
    if(digest!==FORMATTER_SHA256) throw new Error('Formatter module SHA-256 mismatch');
    const module=await WebAssembly.compile(bytes);
    if(WebAssembly.Module.imports(module).length!==0) throw new Error('Formatter has forbidden host imports');
    const instance=await WebAssembly.instantiate(module,{});
    self.postMessage(formatWithWasm(instance,source));
  } catch(error) {
    self.postMessage({ok:false,diagnostic:'E_FORMAT: '+String(error?.message||error).slice(0,4096)});
  }
};
