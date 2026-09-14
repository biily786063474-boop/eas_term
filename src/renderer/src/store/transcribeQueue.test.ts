import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'
const source=readFileSync(new URL('./uiSlice.ts',import.meta.url),'utf8')
const block=source.slice(source.indexOf('async function runTranscribeQueue('),source.indexOf('/** 「跟随系统」'))
const code=ts.transpileModule(block.replace("await import('../features/wiki/transcribe')",'({transcribeFile:transcribeDependency})'),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText
function fixture(result:any,saveResult:any={ok:true}){
 let state:any={ttQueue:[{name:'audio.wav',path:'/audio.wav',state:'wait',done:0,total:0}]}
 const saves:any[]=[]
 const run=new Function('transcribeDependency','window','let ttRunning=false;'+code+';return runTranscribeQueue')(async()=>result,{api:{wiki:{saveTranscript:async(name:string,text:string)=>{saves.push({name,text});return saveResult}}}})
 return {run:()=>run((fn:any)=>state={...state,...fn(state)},()=>state),state:()=>state.ttQueue[0],saves}
}
test('failed transcript preserves partial text without overwriting successful transcript or marking done',async()=>{
 const f=fixture({ok:false,text:'[00:00] retained',error:'cancelled'})
 await f.run();assert.equal(f.state().state,'fail');assert.equal(f.state().text,'[00:00] retained')
 assert.equal(f.saves.length,1);assert.notEqual(f.saves[0].name,'audio.wav');assert.match(f.saves[0].text,/retained/);assert.match(f.saves[0].text,/未完成/)
 await f.run();assert.equal(f.saves.length,1)
})
test('write failure cannot become completed and retains transcript in memory',async()=>{
 const f=fixture({ok:true,text:'retained'},{ok:false,error:'disk full'})
 await f.run();assert.equal(f.state().state,'fail');assert.equal(f.state().text,'retained');assert.match(f.state().error,/disk full/)
})
