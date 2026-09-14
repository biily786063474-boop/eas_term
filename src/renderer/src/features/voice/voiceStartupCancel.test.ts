import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
test('cancel during microphone initialization notifies main rather than waiting for admission timeout',async()=>{
 const source=fs.readFileSync(new URL('./VoiceButton.tsx',import.meta.url),'utf8')
 const block=source.slice(source.indexOf('  const stop = (writeTail'),source.indexOf('  stopRef.current ='))
 const js=ts.transpileModule(block,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText
 let calls=0
 const deps={run:{cancel(){}},document:{dispatchEvent(){}},Event:class{},stopping:{current:null},starting:{current:true},window:{api:{stt:{stop:async()=>{calls++;return{text:''}}}}}}
 const stop=new Function(...Object.keys(deps),js+';return stop')(...Object.values(deps))
 await stop(false);assert.equal(calls,1)
})
