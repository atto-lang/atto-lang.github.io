import test from 'node:test';
import assert from 'node:assert/strict';
import {MessageChannel} from 'node:worker_threads';
import {ActorWorkerSupervisor} from '../src/actor-worker-supervisor.js';

class ActorWorkerProbe {
  static all=[];
  constructor(){this.terminated=0;this.delivered=[];ActorWorkerProbe.all.push(this);}
  postMessage(message){this.delivered.push(message);}
  terminate(){this.terminated++;}
  send(message){this.onmessage?.({data:message});}
}
function newOwner(){
  ActorWorkerProbe.all=[];
  return new ActorWorkerSupervisor({
    WorkerImpl:ActorWorkerProbe,MessageChannelImpl:MessageChannel,childUrl:'probe-worker.js'
  });
}
test('late callback captured before parent close cannot restore a retired actor',()=>{
  const owner=newOwner();
  const scope=owner.reserve(4);
  const workers=ActorWorkerProbe.all.slice();
  const callbacks=workers.map(w=>w.onmessage);
  workers[0].send({kind:'ready',actorId:0});
  assert.equal(owner.stats().ready,1);
  scope.close();
  for(let i=0;i<4;i++){
    callbacks[i]({data:{kind:'ready',actorId:i}});
    callbacks[i]({data:{kind:'message',actorId:i,sequence:99}});
  }
  assert.equal(owner.stats().ready,1,'late callback forged a readiness receipt');
  assert.equal(owner.stats().activeChildren,0);
  assert.equal(owner.stats().dispatched,0);
  assert.equal(owner.stats().terminated,4);
  assert.ok(workers.every(w=>w.terminated===1));
});

test('duplicate readiness revokes only that child, not its three siblings',()=>{
  const owner=newOwner(),scope=owner.reserve(4);
  const children=ActorWorkerProbe.all;
  children[0].send({kind:'ready',actorId:0});
  children[0].send({kind:'ready',actorId:0});
  assert.equal(owner.stats().ready,1);
  assert.equal(owner.stats().activeChildren,3);
  assert.equal(children[0].terminated,1);
  assert.ok(children.slice(1).every(w=>w.terminated===0));
  children[1].send({kind:'ready',actorId:1});
  assert.equal(owner.stats().ready,2);
  scope.close();
  assert.ok(children.every(w=>w.terminated===1));
  assert.equal(owner.stats().uncertain,0);
});

test('reused worker pool cannot accept stale callbacks over a new generation',()=>{
  const owner=newOwner();
  const old=owner.reserve(2);
  const callbacks=ActorWorkerProbe.all.map(w=>w.onmessage);
  old.close();
  const current=owner.reserve(2);
  ActorWorkerProbe.all[2].send({kind:'ready',actorId:0});
  assert.equal(owner.stats().ready,1);
  callbacks[0]({data:{kind:'ready',actorId:0}});
  callbacks[1]({data:{kind:'ready',actorId:1}});
  assert.equal(owner.stats().ready,1);
  assert.equal(owner.stats().activeChildren,2);
  current.close();
  assert.equal(owner.stats().created,4);
  assert.equal(owner.stats().terminated,4);
  assert.equal(owner.stats().uncertain,0);
});
