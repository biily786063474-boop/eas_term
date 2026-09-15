import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import {EventEmitter} from 'node:events'
import {openManagedPreview} from './voicePreviewAdmission.ts'
import {createRuntimeManager} from './manager.ts'
import {installSessionStartup} from './sessionStartup.ts'
test('actual recording start opens the preview lease immediately even under critical pressure; cancellation never creates a recording stream',async()=>{
 const manager=createRuntimeManager({now:()=>1});installSessionStartup(manager)
 const source=fs.readFileSync(new URL('../stt.ts',import.meta.url),'utf8')
 const globals=source.slice(source.indexOf('// 会话态'),source.indexOf('function concatChunks'))
 const start=source.slice(source.indexOf("  guardedHandle('stt:start'"),source.indexOf('  function routeAudio'))
 const end=source.slice(source.indexOf("  guardedHandle('stt:stop'"),source.lastIndexOf('\n}'))
 const handlers:any={},sender=Object.assign(new EventEmitter(),{id:9,isDestroyed:()=>false,send(){}})
 let loads=0,resolveReady!:()=>void
 const deps={ipcMain:{handle:(n:string,f:any)=>handlers[n]=f},guardedHandle:(n:string,f:any)=>handlers[n]=f,guardedOn:(n:string,f:any)=>handlers[n]=f,VoiceGate:class{reset(){}},process:{platform:'linux'},readyDir:()=>'/fixture',MODELS:{stream:{},vad:{}},path:{join:(...p:string[])=>p.join('/')},openManagedPreview,createPreviewWorker:()=>{loads++;let done!:()=>void;return {ready:new Promise<void>(r=>{resolveReady=r}),completed:new Promise<void>(r=>{done=r}),stop(){done()},push:()=>true,takeText:async()=>''}},transcribeAsync:async()=>null}
 new Function(...Object.keys(deps),ts.transpileModule(globals+start+end,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText)(...Object.values(deps))
 // 2026-09-14：语音永不排队 —— 严重压力下也立刻开 lease（模型可能还在加载）
 manager.update({at:0,cpu:1,memoryUsedBytes:1,totalMemoryBytes:8*1024**3,critical:true})
 const pending=handlers['stt:start']({sender},'basic')
 await new Promise(r=>setImmediate(r));assert.equal(loads,1,'lease opened without waiting for admission')
 // 模型加载中停止录音：启动取消，不会再去开 VAD / 录音流
 await handlers['stt:stop']({sender});resolveReady();assert.equal((await pending).ok,false)
 manager.dispose()
})
