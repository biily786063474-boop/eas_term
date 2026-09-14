import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createRuntimeManager} from './manager.ts'
import {installSessionStartup,startManagedSession,queuedSessionStarts,cancelSessionStart,cancelSessionStartsForWindow} from './sessionStartup.ts'
test('session start waits for capacity, has window cancellation, and holds budget until actual exit',async()=>{
 let now=0,exit!:()=>void,calls=0
 const m=createRuntimeManager({now:()=>now,maxRunning:1});installSessionStartup(m)
 const start=()=>{calls++;return Promise.resolve({value:'pty-id',completed:new Promise<void>(r=>exit=r)})}
 const cancelled=startManagedSession({id:'cancel',windowId:7,name:'终端',projectId:null,cost:{cpu:3,memoryBytes:100},start})
 assert.equal(queuedSessionStarts(7)[0].state,'queued');assert.equal(cancelSessionStart('cancel',8),false)
 assert.equal(cancelSessionStart('cancel',7),true);await assert.rejects(cancelled,/cancelled/);assert.equal(calls,0)
 const abandoned=startManagedSession({id:'abandoned',windowId:9,name:'终端',projectId:null,cost:{cpu:3,memoryBytes:100},start})
 cancelSessionStartsForWindow(9);await assert.rejects(abandoned,/cancelled/);assert.equal(calls,0)
 const p=startManagedSession({id:'start',windowId:7,name:'终端',projectId:null,cost:{cpu:3,memoryBytes:100},start})
 m.update({at:0,cpu:10,memoryUsedBytes:100,totalMemoryBytes:1000,critical:false})
 assert.equal(await p,'pty-id');assert.equal(m.snapshot().running,0);assert.equal(m.snapshot().reserved.memoryBytes,100)
 assert.equal(queuedSessionStarts(7).length,0);exit();await new Promise(r=>setImmediate(r));assert.equal(m.snapshot().reserved.memoryBytes,0);m.invalidateMetrics()
 const refs=new Set([31,32])
 const pending=startManagedSession({id:'shared',windowId:31,sharedWindows:refs,name:'LSP',projectId:'p',cost:{cpu:1,memoryBytes:1},start:async()=>{throw Error('must not spawn')}})
 const settled=assert.rejects(pending,/cancelled/)
 assert.equal(cancelSessionStart('shared',31),false)
 cancelSessionStartsForWindow(31);assert.deepEqual([...refs],[32]);assert.equal(queuedSessionStarts(32).length,1)
 cancelSessionStartsForWindow(32);await settled
 m.dispose()
})
