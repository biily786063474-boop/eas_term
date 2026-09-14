import {test} from 'node:test'
import assert from 'node:assert/strict'
import {Worker} from 'node:worker_threads'
import {createWorkerRequests} from './workerRequests.ts'

test('real worker caller timeout preserves capacity until its actual response',async()=>{
 const requests=createWorkerRequests<string>(1)
 const worker=new Worker(`const {parentPort}=require('node:worker_threads');parentPort.on('message',id=>setTimeout(()=>parentPort.postMessage({id,text:'finished'}),80))`,{eval:true,execArgv:[]})
 worker.on('message',m=>requests.settle(m.id,worker,m.text))
 worker.once('exit',()=>requests.failOwner(worker))
 try{
  const request=requests.begin(1,worker,1)!
  worker.postMessage(1)
  assert.equal(await request.result,null)
  assert.equal(requests.size,1)
  assert.equal(requests.begin(2,worker,100),null)
  await request.completed
  assert.equal(requests.size,0)
 }finally{await worker.terminate()}
})

test('real worker termination settles outstanding work only after exit',async()=>{
 const requests=createWorkerRequests<string>(1)
 const worker=new Worker(`const {parentPort}=require('node:worker_threads');parentPort.on('message',()=>{})`,{eval:true,execArgv:[]})
 let exited=false
 worker.once('exit',()=>{exited=true;requests.failOwner(worker)})
 try{
  const request=requests.begin(1,worker,10000)!
  const termination=worker.terminate()
  await request.completed
  assert.equal(exited,true)
  assert.equal(await request.result,null)
  assert.equal(requests.size,0)
  await termination
 }finally{await worker.terminate()}
})
