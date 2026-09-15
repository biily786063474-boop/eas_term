import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {EventEmitter} from 'node:events'
import ts from 'typescript'
import {createRuntimeManager} from './manager.ts'
import {installSessionStartup,queuedSessionStarts} from './sessionStartup.ts'
import {createOwnedSessions} from './ownedSessions.ts'
const tick=()=>new Promise(r=>setImmediate(r))
test('VAD 不进准入队列：严重压力下也立刻起 worker；录音取消 / 运行页关闭 / 导航各自收口，预算恒为 0', async () => {
 const source=readFileSync(new URL('./managedVad.ts',import.meta.url),'utf8').replace(/^import .*$/gm,'').replaceAll('export ','')
 const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText
 let now=0,starts=0,stops=0,exit!:()=>void
 const manager=createRuntimeManager({now:()=>now});installSessionStartup(manager)
 manager.update({at:++now,cpu:1,memoryUsedBytes:1,totalMemoryBytes:8*1024**3,critical:true}) // 2026-09-14：用户要语音永不排队
 const owned=createOwnedSessions(()=>now),notices:string[]=[]
 const owner=Object.assign(new EventEmitter(),{id:7,isDestroyed:()=>false})
 let gate:Promise<void>=Promise.resolve()
 const raw=async()=>{starts++;await gate;return {completed:new Promise<void>(r=>exit=r),stop(){stops++;exit()},drain:async()=>{},push:()=>true}}
 const open=new Function('ownedSessions','openVoiceVad',js+';return openManagedVad')(owned,raw)
 const args=[owner,'/model',()=>{},(message:string)=>notices.push(message),false]
 // 立刻启动，不排队、不占预算
 const s=await open(...args);assert.equal(starts,1);assert.equal(queuedSessionStarts(7).length,0);assert.equal(manager.snapshot().reserved.memoryBytes,0)
 assert.equal(owned.list(8).length,0);assert.equal(owned.list(7)[0].kind,'voice')
 // 运行页关闭 → 停 + 通知录音层
 assert.equal((await owned.stop(owned.list(7)[0].id,7,async()=>true)).ok,true)
 assert.equal(stops,1);assert.equal(notices.length,1);await s.completed;await tick();assert.equal(owned.list(7).length,0)
 assert.equal(owner.listenerCount('destroyed'),0)
 // worker 还没 ready 就取消录音：起完立刻停、抛 cancelled
 let release!:()=>void;gate=new Promise<void>(r=>release=r)
 const aborter=new AbortController();const aborted=open(...args,aborter.signal);const rejected=assert.rejects(aborted,/cancelled/)
 aborter.abort();release();await rejected;assert.equal(starts,2);assert.equal(stops,2);await tick();assert.equal(owned.list(7).length,0)
 // 导航 → 停
 gate=Promise.resolve();const next=await open(...args);owner.emit('did-navigate');assert.equal(stops,3);await next.completed;await tick()
 assert.equal(owned.list(7).length,0);assert.equal(owner.listenerCount('did-navigate'),0);manager.dispose()
})
