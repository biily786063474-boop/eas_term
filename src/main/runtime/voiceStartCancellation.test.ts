import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import {EventEmitter} from 'node:events'
for (const event of ['stop','did-navigate','render-process-gone','destroyed']) test(event+' during VAD startup invalidates late session',async()=>{
 const source=fs.readFileSync(new URL('../stt.ts',import.meta.url),'utf8')
 const globals=source.slice(source.indexOf('// 会话态'),source.indexOf('function concatChunks'))
 const start=source.slice(source.indexOf("  guardedHandle('stt:start'"),source.indexOf('  function routeAudio'))
 const end=source.slice(source.indexOf("  guardedHandle('stt:stop'"),source.lastIndexOf('\n}'))
 const js=ts.transpileModule(globals+start+end,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText
 const handlers:any={},sender=Object.assign(new EventEmitter(),{id:9,isDestroyed:()=>false,send(){}})
 let signal:AbortSignal|undefined,ready!:(value:any)=>void,stops=0
 const open=async(...args:any[])=>{signal=args[5];return new Promise(r=>ready=r)}
 const deps={openManagedPreview:async()=>({stop(){},push:()=>true,takeText:async()=>''}),ipcMain:{handle:(name:string,fn:any)=>handlers[name]=fn},guardedHandle:(name:string,fn:any)=>handlers[name]=fn,guardedOn:(name:string,fn:any)=>handlers[name]=fn,VoiceGate:class{reset(){}},process:{platform:'linux'},readyDir:()=>'/fixture',MODELS:{stream:{},vad:{}},ensureRecognizer:async()=>({createStream:()=>({})}),path:{join:()=>'/fixture'},openManagedVad:open,recognizer:null,transcribeAsync:async()=>null}
 new Function(...Object.keys(deps),js)(...Object.values(deps))
 const started=handlers['stt:start']({sender},'standard');await new Promise(r=>setImmediate(r))
 assert.ok(signal,'recording startup owns an abort signal')
 if(event==='stop') await handlers['stt:stop']({sender}); else sender.emit(event)
 assert.equal(signal.aborted,true)
 ready({stop(){stops++},completed:Promise.resolve()})
 assert.equal((await started).ok,false);assert.equal(stops,1)
})
