import test from 'node:test';
import assert from 'node:assert/strict';
import { MessageChannel } from 'node:worker_threads';
import { ActorWorkerSupervisor } from '../src/actor-worker-supervisor.js';

const flush = () => new Promise(resolve => setImmediate(resolve));

class ScriptedWorker {
  static instances = [];
  constructor(url) {
    this.url = url;
    this.sent = [];
    this.terminations = 0;
    ScriptedWorker.instances.push(this);
  }
  postMessage(message) {
    this.sent.push(message);
    if (message?.kind === 'force-clone-error')
      throw new Error('DataCloneError: injected');
  }
  terminate() { this.terminations++; }
  reply(data) { this.onmessage?.({data}); }
  fail() { this.onerror?.({message:'injected child failure'}); }
}
function makeOwner(options={}) {
  ScriptedWorker.instances=[];
  return new ActorWorkerSupervisor({
    WorkerImpl:ScriptedWorker, MessageChannelImpl:MessageChannel,...options
  });
}

test('admission is capped at four, active reservations cannot overlap, and closed scopes are reusable', () => {
  const owner=makeOwner();
  for(const invalid of [0,-1,5,1.5,NaN,Infinity,'4'])
    assert.throws(()=>owner.reserve(invalid),/E_ACTOR_SUPERVISOR_LIMIT/);
  assert.equal(owner.stats().created,0);
  for(let round=0;round<64;round++){
    const scope=owner.reserve(4);
    assert.throws(()=>owner.reserve(1),/E_ACTOR_SUPERVISOR_BUSY/);
    assert.equal(owner.stats().activeChildren,4);
    scope.close();
    scope.close();
    assert.equal(owner.stats().activeChildren,0);
    assert.equal(owner.stats().created,4*(round+1));
    assert.equal(owner.stats().terminated,4*(round+1));
  }
  assert.equal(owner.stats().maxActive,4);
  assert.ok(ScriptedWorker.instances.every(w=>w.terminations===1));
});

test('unknown protocol operation revokes only its leased child and fences stale messages', async () => {
  const owner=makeOwner();
  const scope=owner.reserve(4);
  const children=ScriptedWorker.instances;
  scope.ports[1].postMessage({op:'forged',data:{kind:'message'}});
  await flush();
  assert.equal(owner.stats().activeChildren,3);
  assert.equal(children[1].terminations,1);
  const before=owner.stats().dispatched;
  scope.ports[1].postMessage({op:'post',data:{kind:'message',value:99n}});
  await flush();
  assert.equal(owner.stats().dispatched,before,'revoked port dispatched stale message');
  assert.deepEqual(children[1].sent,[]);
  scope.close();
  assert.equal(owner.stats().activeChildren,0);
  assert.equal(owner.stats().terminated,4);
  assert.ok(children.every(w=>w.terminations===1));
});

test('child postMessage clone error revokes its lease and cannot execute retry', async () => {
  const owner=makeOwner();
  const scope=owner.reserve(4);
  const child=ScriptedWorker.instances[0];
  scope.ports[0].postMessage({op:'post',data:{kind:'force-clone-error'}});
  await flush();
  assert.equal(owner.stats().activeChildren,3);
  assert.equal(child.terminations,1);
  scope.ports[0].postMessage({op:'post',data:{kind:'message',value:7n}});
  await flush();
  assert.deepEqual(child.sent,[{kind:'force-clone-error'}]);
  scope.close();
  assert.equal(owner.stats().created,4);
  assert.equal(owner.stats().terminated,4);
  assert.equal(owner.stats().uncertain,0);
});

test('child execution failure is terminal and sibling leases remain independently managed', () => {
  const owner=makeOwner();
  const scope=owner.reserve(4);
  ScriptedWorker.instances[2].fail();
  assert.equal(owner.stats().activeChildren,3);
  assert.equal(ScriptedWorker.instances[2].terminations,1);
  assert.equal(ScriptedWorker.instances[0].terminations,0);
  scope.close();
  assert.ok(ScriptedWorker.instances.every(w=>w.terminations===1));
  assert.equal(owner.stats().activeChildren,0);
});

test('message-port event forwarding errors revoke child instead of leaking owner handles', () => {
  class RefusingPortChannel extends MessageChannel {
    constructor() {
      super();
      this.port1.postMessage=()=>{throw new Error('E_INJECT_PORT_WRITE');};
    }
  }
  const owner=makeOwner({MessageChannelImpl:RefusingPortChannel});
  const scope=owner.reserve(4);
  ScriptedWorker.instances[0].reply({kind:'ready',actorId:0});
  assert.equal(owner.stats().activeChildren,3);
  assert.equal(ScriptedWorker.instances[0].terminations,1);
  scope.close();
  assert.equal(owner.stats().activeChildren,0);
  assert.equal(owner.stats().created,owner.stats().terminated);
});

test('handler-registration failure after third child preserves exact terminal accounting', () => {
  class HostileWorker extends ScriptedWorker {
    constructor(url) {
      super(url);
      if(ScriptedWorker.instances.length===3)
        Object.defineProperty(this,'onmessage',{set(){throw new Error('E_HANDLER_REGISTRATION')}});
    }
  }
  const owner=makeOwner({WorkerImpl:HostileWorker});
  assert.throws(()=>owner.reserve(4),/E_HANDLER_REGISTRATION/);
  assert.equal(owner.stats().created,3);
  assert.equal(owner.stats().terminated,3);
  assert.equal(owner.stats().activeChildren,0);
  assert.ok(ScriptedWorker.instances.every(w=>w.terminations===1));
});

test('failed termination during partial child setup quarantines all future actor reservations', () => {
  class UncertainWorker extends ScriptedWorker {
    constructor(url) {
      super(url);
      this.index=ScriptedWorker.instances.length;
    }
    terminate() {
      super.terminate();
      // Only the second constructed child fails; the first still closes.
      if(this.index===2)throw new Error('terminate failed');
    }
  }
  let channels=0;
  class FailingSecondChannel extends MessageChannel {
    constructor() {
      if(++channels===2)throw Error('E_CHANNEL_FAIL');
      super();
    }
  }
  const owner=makeOwner({WorkerImpl:UncertainWorker,MessageChannelImpl:FailingSecondChannel});
  assert.throws(()=>owner.reserve(4),/E_CHANNEL_FAIL/);
  assert.equal(owner.stats().created,2);
  assert.equal(owner.stats().terminated,2);
  assert.equal(owner.stats().uncertain,1);
  assert.equal(owner.stats().activeChildren,0);
  assert.throws(()=>owner.reserve(1),/E_ACTOR_SUPERVISOR_UNCERTAIN/);
  assert.equal(owner.stats().created,2);
});

test('128 generations reject replay over closed ports and preserve exact accounting', async () => {
  const owner=makeOwner();
  for(let gen=0;gen<128;gen++){
    const scope=owner.reserve(4);
    const first=ScriptedWorker.instances[gen*4];
    scope.ports[0].postMessage({op:'post',data:{kind:'message',seq:gen}});
    await flush();
    assert.equal(first.sent.length,1,'message lost before close');
    scope.close();
    scope.ports[0].postMessage({op:'post',data:{kind:'message',seq:-1}});
    first.reply({kind:'ready',actorId:0});
    await flush();
    assert.equal(first.sent.length,1,'replay crossed generation');
    assert.equal(owner.stats().activeChildren,0);
    assert.equal(owner.stats().created,(gen+1)*4);
    assert.equal(owner.stats().terminated,(gen+1)*4);
    assert.equal(owner.stats().uncertain,0);
  }
  assert.equal(owner.stats().maxActive,4);
});
