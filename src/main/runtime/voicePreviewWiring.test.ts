import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import {EventEmitter} from 'node:events'
import {openManagedPreview} from './voicePreviewAdmission.ts'
import {createRuntimeManager} from './manager.ts'
import {installSessionStartup} from './sessionStartup.ts'
test('actual recording start queues preview load and cancellation never creates a recording stream',async()=>{
 const manager=createRuntimeManager({now:()=>1});installSessionStartup(manager)
 const source=fs.readFileSync(new URL('../stt.ts',import.meta.url),'utf8')
 const globals=source.slice(source.indexOf('// 会话态'),source.indexOf('function concatChunks'))
 const start=source.slice(source.indexOf("  ipcMain.handle('stt:start'"),source.indexOf('  function routeAudio'))
 const end=source.slice(source.indexOf("  ipcMain.handle('stt:stop'"),source.lastIndexOf('\n}'))
 const handlers:any={},sender=Object.assign(new EventEmitter(),{id:9,isDestroyed:()=>false,send(){}})
 let loads=0,streams=0
 const deps={ipcMain:{handle:(n:string,f:any)=>handlers[n]=f},VoiceGate:class{reset(){}},process:{platform:'linux'},readyDir:()=>'/fixture',MODELS:{stream:{},vad:{}},createPreviewWorker:()=>{loads++;streams++;return {ready:Promise.resolve(),completed:Promise.resolve(),stop(){},push:()=>true,takeText:async()=>''}},openManagedPreview,transcribeAsync:async()=>null}
 new Function(...Object.keys(deps),ts.transpileModule(globals+start+end,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText)(...Object.values(deps))
 const pending=handlers['stt:start']({sender},'basic')
 await new Promise(r=>setImmediate(r));assert.equal(loads,0)
 await handlers['stt:stop']({sender});assert.equal((await pending).ok,false)
 manager.update({at:1,cpu:1,memoryUsedBytes:1,totalMemoryBytes:8*1024**3,critical:false})
 await new Promise(r=>setImmediate(r));assert.equal(loads,0);assert.equal(streams,0);manager.dispose()
})
