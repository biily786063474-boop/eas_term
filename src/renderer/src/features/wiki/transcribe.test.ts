import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'
const source=readFileSync(new URL('./transcribe.ts',import.meta.url),'utf8')
const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText
function fixture(results:(string|Error)[]){
 const exports:any={}, calls:number[]=[],progress:any[]=[]
 class Audio {async decodeAudioData(){return {duration:24}}async close(){}}
 class Offline {destination={};createBufferSource(){return {connect(){},start(){}}}async startRendering(){return {getChannelData:()=>new Float32Array(24*16000)}}}
 new Function('exports','window','AudioContext','OfflineAudioContext',code)(exports,{api:{fs:{readBinary:async()=>({ok:true,data:new ArrayBuffer(1)})},stt:{transcribeChunk:async()=>{calls.push(1);const r=results.shift();if(r instanceof Error)throw r;return r}}}},Audio,Offline)
 return {run:()=>exports.transcribeFile('/fixture.wav',(p:any)=>progress.push(p)),calls,progress}
}
test('failed second segment stops without replay, retains first transcript and reports failure',async()=>{
 const f=fixture(['第一段',Error('cancelled'),'不可执行'])
 const r=await f.run()
 assert.equal(r.ok,false);assert.equal(r.text,'[00:00] 第一段');assert.match(r.error,/已取消/)
 assert.equal(f.calls.length,2);assert.equal(f.progress.length,1);assert.equal(f.progress[0].done,1)
})
test('actual empty recognition advances normally',async()=>{
 const f=fixture(['','第二段','']);const r=await f.run()
 assert.equal(r.ok,true);assert.equal(r.text,'[00:08] 第二段');assert.equal(f.progress.length,3)
})

test('Electron IPC wrapper must not hide the actionable queue failure',async()=>{
 const f=fixture([Error("Error invoking remote method 'stt:transcribeChunk': Error: wait timeout")]);const r=await f.run()
 assert.equal(r.ok,false);assert.match(r.error,/等待资源超时/);assert.doesNotMatch(r.error,/invoking remote method/)
})
