// Private actor execution domain: each actor owns a separate Web Worker and
// a separate WebAssembly.Instance. Host may send only signed i64 payloads.
import { integratedActorExports } from './guest.js';
let receiver=null, guest=null, processed=0;
self.onmessage=({data})=>{
  try{
    if(data?.kind==='init'){
      if(receiver)throw new Error('E_ACTOR_DUP_INIT');
      if(!Number.isInteger(data.actorId)||data.actorId<0||data.actorId>1024)throw new Error('E_ACTOR_ID');
      if(!(data.wasm instanceof Uint8Array)||!WebAssembly.validate(data.wasm))throw new Error('E_ACTOR_WASM');
      const module=new WebAssembly.Module(data.wasm);
      integratedActorExports(module, data.actorId);
      const allow=new Set(['actor_spawn','print_i64','print_bool','print_str','print_newline','actor_send','actor_join']);
      for(const imp of WebAssembly.Module.imports(module)){
        if(imp.module!=='atto'||!allow.has(imp.name))throw new Error('E_ACTOR_IMPORT');
      }
      const atto={
        actor_spawn:()=>{throw new Error('E_ACTOR_NESTED_SPAWN')},
        actor_send:()=>{throw new Error('E_ACTOR_NESTED_SEND')},
        actor_join:()=>{throw new Error('E_ACTOR_NESTED_JOIN')},
        print_i64:()=>{throw new Error('E_ACTOR_STDIO')},
        print_bool:()=>{throw new Error('E_ACTOR_STDIO')},
        print_str:()=>{throw new Error('E_ACTOR_STDIO')},
        print_newline:()=>{throw new Error('E_ACTOR_STDIO')},
      };
      guest=new WebAssembly.Instance(module,{atto});
      receiver=guest.exports['atto_actor_receive_'+data.actorId];
      if(typeof receiver!=='function')throw new Error('E_ACTOR_RECEIVE_EXPORT');
      self.postMessage({kind:'ready'});
      return;
    }
    if(data?.kind==='message'){
      if(!receiver)throw new Error('E_ACTOR_NOT_READY');
      if(typeof data.value!=='bigint'||BigInt.asIntN(64,data.value)!==data.value)throw new Error('E_MESSAGE_TYPE');
      const result=receiver(data.value);
      if(typeof result!=='bigint')throw new Error('E_ACTOR_RESULT');
      processed++;
      self.postMessage({kind:'reply',value:result});
      return;
    }
    if(data?.kind==='close'){
      if(!receiver)throw new Error('E_ACTOR_NOT_READY');
      receiver=null;
      self.postMessage({kind:'done',processed});
      self.close();
      return;
    }
    throw new Error('E_ACTOR_PROTOCOL');
  }catch(error){
    const panic=guest?.exports?.panic_code?.value||0;
    self.postMessage({kind:'error',message:panic?'E_ACTOR_PANIC_'+panic:String(error.message)});
    self.close();
  }
};
