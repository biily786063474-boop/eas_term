import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createRuntimeManager} from './manager.ts'
import {installSessionStartup,runManagedTask,queuedSessionStarts,cancelSessionStart} from './sessionStartup.ts'

// 更新包下载这类「用户刚点、几乎不占资源」的任务：immediate 不排队（2026-09-29）。
// 单独一个文件：installSessionStartup 是进程级单例，一个测试文件只能装一次。
test('immediate 任务：资源门关着也立即开始、不出现排队态，仍可取消',async()=>{
 const m=createRuntimeManager({now:()=>0,maxRunning:1});installSessionStartup(m)
 // 资源紧张：普通任务在这里会排队
 m.update({at:0,cpu:99,memoryUsedBytes:990,totalMemoryBytes:1000,critical:false})
 let started=false,aborted=false
 const p=runManagedTask<string>({id:'update-download:t',windowId:7,name:'更新包下载',projectId:null,immediate:true,cost:{cpu:3,memoryBytes:64},start:async signal=>{
  started=true;signal.addEventListener('abort',()=>{aborted=true})
  const result=new Promise<string>((_r,reject)=>signal.addEventListener('abort',()=>reject(Error('cancelled'))))
  return {result,completed:result.then(()=>{},()=>{})}
 }})
 await new Promise(r=>setImmediate(r))
 assert.equal(started,true,'立即开始')
 assert.equal(queuedSessionStarts(7).filter(x=>x.state==='queued').length,0,'不出现排队态')
 assert.equal(cancelSessionStart('update-download:t',7),true,'仍可取消')
 await assert.rejects(p,/cancelled/);assert.equal(aborted,true)
 m.dispose()
})
