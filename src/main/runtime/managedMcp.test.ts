import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createRuntimeManager} from './manager.ts'
import {runManagedMcp} from './managedMcp.ts'
import {McpClient} from '../mcpClient.ts'
test('real timed-out MCP work keeps manager budget until actual child exit',async()=>{
 const manager=createRuntimeManager({now:()=>1})
 manager.update({at:1,cpu:0,memoryUsedBytes:0,totalMemoryBytes:10000,critical:false})
 const client=new McpClient({name:'managed-test',command:process.execPath,args:['-e',`process.stdin.resume();setInterval(()=>{},1000)`],env:{},cwd:process.cwd()})
 const exit=new Promise<void>(r=>{client.onExit=()=>r()})
 try{
  await assert.rejects(runManagedMcp(manager,client,{id:'one',projectId:'test',cost:{cpu:5,memoryBytes:100}},'tools/call',{},20),/超时/)
  assert.equal(manager.snapshot().reserved.cpu,5)
  manager.cancel('one')
  assert.equal(manager.snapshot().reserved.cpu,5)
  client.close();await exit
  await new Promise(r=>setImmediate(r))
  assert.equal(manager.snapshot().reserved.cpu,0)
 }finally{client.close();await exit;manager.dispose()}
})
test('queued cancellation rejects caller and never invokes the MCP client',async()=>{
 const manager=createRuntimeManager({now:()=>1});let calls=0
 const client={requestTracked(){calls++;throw Error('must not dispatch')}} as unknown as McpClient
 const result=runManagedMcp(manager,client,{id:'queued',projectId:'test',cost:{cpu:5,memoryBytes:100}},'tools/call',{})
 const rejected=assert.rejects(result,/cancel/i)
 manager.cancel('queued');await rejected
 assert.equal(calls,0);assert.equal(manager.snapshot().reserved.cpu,0)
 manager.dispose()
})
