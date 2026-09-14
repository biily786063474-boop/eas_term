import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {LspClient} from '../lspClient.ts'
import {createRuntimeManager} from './manager.ts'
import {installSessionStartup,startManagedSession,cancelSessionStart} from './sessionStartup.ts'
test('real clangd waits, cancels without spawn, then retains budget until child close',{skip:process.env.EAS_VERIFY_REAL_LSP!=='1',timeout:15000},async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'eas-lsp-admission-'))
 const manager=createRuntimeManager({now:()=>0});installSessionStartup(manager)
 const client=new LspClient({bin:'/usr/bin/clangd',args:['--background-index=false','--log=error'],label:'验收 clangd'},root)
 let starts=0
 const start=async()=>{starts++;const ready=client.start();void ready.catch(()=>{});return {value:ready,completed:client.completed}}
 try{
  const cancelled=startManagedSession({id:'cancel-lsp',windowId:1,name:'clangd',projectId:null,cost:{cpu:7,memoryBytes:512*1024**2},start})
  assert.equal(starts,0);assert.equal(cancelSessionStart('cancel-lsp',1),true);await assert.rejects(cancelled,/cancelled/);assert.equal(starts,0)
  const run=startManagedSession({id:'real-lsp',windowId:1,name:'clangd',projectId:null,cost:{cpu:7,memoryBytes:512*1024**2},start})
  manager.update({at:0,cpu:1,memoryUsedBytes:1,totalMemoryBytes:4*1024**3,critical:false});await run
  assert.equal(starts,1);assert.equal(manager.snapshot().running,0);assert.equal(manager.snapshot().reserved.memoryBytes,512*1024**2)
  client.stop();await client.completed;await new Promise(r=>setImmediate(r));assert.equal(manager.snapshot().reserved.memoryBytes,0)
 }finally{client.stop();manager.dispose();fs.rmSync(root,{recursive:true,force:true})}
})
