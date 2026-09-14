import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createOwnedSessions} from './ownedSessions.ts'
test('owned session stop rechecks identity after confirmation and waits for exit',async()=>{
 let now=10,exit!:()=>void,stops=0
 const r=createOwnedSessions(()=>now)
 r.add({id:'pty:1',name:'终端',windowId:1,projectId:'p',kind:'terminal',completed:new Promise<void>(resolve=>exit=resolve),stop:()=>{stops++}})
 now=1010;assert.equal(r.list(1)[0].uptimeMs,1000);assert.equal(r.list(2).length,0)
 assert.equal((await r.stop('pty:1',2,async()=>true)).ok,false)
 assert.equal((await r.stop('pty:1',1,async()=>false)).ok,false);assert.equal(stops,0)
 assert.equal((await r.stop('pty:1',1,async()=>true)).ok,true);assert.equal(stops,1)
 assert.equal(r.list(1)[0].state,'stopping');assert.equal(r.list(1)[0].canStop,false)
 exit();await new Promise(resolve=>setImmediate(resolve));assert.equal(r.list(1).length,0)
})
test('exit during confirmation cannot stop a replacement session',async()=>{
 let exit!:()=>void,stops=0
 const r=createOwnedSessions(()=>0)
 r.add({id:'x',name:'old',windowId:1,projectId:null,kind:'terminal',completed:new Promise<void>(resolve=>exit=resolve),stop:()=>{stops++}})
 const result=await r.stop('x',1,async()=>{exit();await new Promise(resolve=>setImmediate(resolve));r.add({id:'x',name:'new',windowId:1,projectId:null,kind:'terminal',completed:new Promise(()=>{}),stop:()=>{stops++}});return true})
 assert.equal(result.ok,false);assert.equal(stops,0)
})
