// Page-owned worker registry. Actor workers live outside the disposable
// runner's lifetime so Stop/deadline/error can revoke them independently.
// The ledger counts managed Worker objects and termination attempts, not OS
// process exit or tenant-wide RSS.
export class ActorWorkerSupervisor {
  constructor({WorkerImpl=globalThis.Worker,
    MessageChannelImpl=globalThis.MessageChannel,
    childUrl=new URL('./actor-guest-worker.js',import.meta.url)}={}) {
    this.WorkerImpl=WorkerImpl;
    this.MessageChannelImpl=MessageChannelImpl;
    this.childUrl=childUrl;
    this.active=new Set();
    this.created=0;
    this.terminated=0;
    this.uncertain=0;
    this.dispatched=0;
    this.ready=0;
    this.maxActive=0;
  }
  stats() {
    return Object.freeze({
      activeChildren:this.active.size,created:this.created,
      terminated:this.terminated,uncertain:this.uncertain,
      dispatched:this.dispatched,ready:this.ready,maxActive:this.maxActive
    });
  }
  reserve(slots) {
    if(!Number.isInteger(slots)||slots<1||slots>4)
      throw new Error('E_ACTOR_SUPERVISOR_LIMIT');
    if(this.active.size!==0)throw new Error('E_ACTOR_SUPERVISOR_BUSY');
    const entries=[];
    let closed=false;
    const terminate=(entry)=>{
      if(entry.closed)return;
      entry.closed=true;
      this.active.delete(entry);
      entry.port.onmessage=null;
      entry.port.onmessageerror=null;
      entry.child.onmessage=null;
      entry.child.onerror=null;
      entry.child.onmessageerror=null;
      try {entry.port.close();}catch{}
      try {entry.outbound.close();}catch{}
      try {entry.child.terminate();}
      catch {this.uncertain++;}
      this.terminated++;
    };
    const scope={
      ports:[],
      close:()=>{
        if(closed)return;
        closed=true;
        for(const entry of entries)terminate(entry);
      }
    };
    try {
      for(let i=0;i<slots;i++){
        const child=new this.WorkerImpl(this.childUrl,{type:'module'});
        let channel;
        try {channel=new this.MessageChannelImpl();}
        catch(error) {
          try{child.terminate();}catch{this.uncertain++;}
          throw error;
        }
        const entry={
          child,port:channel.port1,outbound:channel.port2,
          closed:false,index:i
        };
        entries.push(entry);
        this.active.add(entry);
        this.created++;
        this.maxActive=Math.max(this.maxActive,this.active.size);
        const emit=(op,data)=>{
          if(entry.closed)return;
          try{entry.port.postMessage({op,data});}
          catch{terminate(entry);}
        };
        entry.port.onmessage=event=>{
          if(entry.closed)return;
          const msg=event.data;
          if(!msg || typeof msg!=='object')return terminate(entry);
          if(msg.op==='terminate')return terminate(entry);
          if(msg.op!=='post')return terminate(entry);
          try {
            if(msg.data?.kind==='message')this.dispatched++;
            entry.child.postMessage(msg.data);
          }catch{emit('fault');terminate(entry);}
        };
        entry.port.onmessageerror=()=>terminate(entry);
        entry.port.start?.();
        entry.child.onmessage=event=>{
          if(event.data?.kind==='ready')this.ready++;
          emit('event',event.data);
        };
        entry.child.onerror=()=>{emit('fault');terminate(entry);};
        entry.child.onmessageerror=()=>{emit('messageerror');terminate(entry);};
        scope.ports.push(entry.outbound);
      }
      return scope;
    }catch(error){
      scope.close();
      throw error;
    }
  }
}
