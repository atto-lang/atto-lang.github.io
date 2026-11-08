// MessagePort-backed Worker facade. Its actual child Worker is owned by the
// page's supervisor, not by this disposable parent Worker.
export function actorWorkerFromPort(port) {
  if(!(port instanceof MessagePort))throw new Error('E_ACTOR_PORT');
  let closed=false;
  const facade={
    onmessage:null,onerror:null,onmessageerror:null,
    postMessage(data){
      if(closed)throw new Error('E_ACTOR_PORT_CLOSED');
      port.postMessage({op:'post',data});
    },
    terminate(){
      if(closed)return;
      closed=true;
      try{port.postMessage({op:'terminate'});}finally{port.close();}
    }
  };
  port.onmessage=({data})=>{
    if(closed)return;
    if(data?.op==='event')facade.onmessage?.({data:data.data});
    else if(data?.op==='messageerror')facade.onmessageerror?.();
    else facade.onerror?.();
  };
  port.onmessageerror=()=>{if(!closed)facade.onmessageerror?.();};
  port.start?.();
  return facade;
}
