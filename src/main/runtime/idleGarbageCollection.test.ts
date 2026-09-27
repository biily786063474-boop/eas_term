import {test} from 'node:test'
import assert from 'node:assert/strict'
import {EventEmitter} from 'node:events'
import {collectIdleGarbage} from './idleGarbageCollection.ts'
function fixture(){const emitter=new EventEmitter();const d=Object.assign(emitter,{attached:false,isAttached(){return this.attached},attach(){this.attached=true},detach(){this.attached=false;emitter.emit('detach')},sendCommand:async (_m:string)=>{}});return d}
test('foreign debugger is never acquired or released',async()=>{const d=fixture();d.attach();assert.equal(await collectIdleGarbage(d,()=>true),false);assert.equal(d.isAttached(),true)})
test('completed GC releases its own debugger',async()=>{const d=fixture();assert.equal(await collectIdleGarbage(d,()=>true),true);assert.equal(d.isAttached(),false)})
test('activity after attach cancels before GC',async()=>{const d=fixture();let checks=0,calls=0;d.sendCommand=async()=>{calls++};assert.equal(await collectIdleGarbage(d,()=>++checks===1),false);assert.equal(calls,0);assert.equal(d.isAttached(),false)})
test('timeout releases own connection; late rejection is consumed',async()=>{const d=fixture();let reject!:(e:Error)=>void;d.sendCommand=()=>new Promise((_,r)=>reject=r);await assert.rejects(collectIdleGarbage(d,()=>true,15),/timeout/);assert.equal(d.isAttached(),false);reject(Error('late'));await new Promise(r=>setTimeout(r,10))})
test('replacement debugger is retained when original command completes',async()=>{const d=fixture();d.sendCommand=async()=>{d.detach();d.attach()};assert.equal(await collectIdleGarbage(d,()=>true),false);assert.equal(d.isAttached(),true)})

test('timeout after foreign replacement never detaches replacement',async()=>{const d=fixture();d.sendCommand=()=>{d.detach();d.attach();return new Promise(()=>{})};await assert.rejects(collectIdleGarbage(d,()=>true,15),/timeout/);assert.equal(d.isAttached(),true)})
