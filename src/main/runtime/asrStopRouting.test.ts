import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'
import {createSharedServices} from './sharedServices.ts'
test('runtime stop routes owned ASR to the shared registry and retains confirmation/ownership checks',async()=>{
 const source=readFileSync(new URL('./ipc.ts',import.meta.url),'utf8')
 const start=source.indexOf(" guardedHandle('runtime:stopPlugin'")
 const block=source.slice(start,source.indexOf(" let mode:",start))
 const registry=createSharedServices(()=>0)
 let stops=0,exit!:()=>void,confirmations=0,detail='',handler:any
 registry.add({id:'voice-asr:fixture',name:'ASR',kind:'voice',completed:new Promise<void>(r=>exit=r),stop(){stops++}})
 registry.retain('voice-asr:fixture',1,null)
 const win={isDestroyed:()=>false}
 const deps={ipcMain:{handle:(_n:string,fn:any)=>handler=fn},guardedHandle:(_n:string,fn:any)=>handler=fn,BrowserWindow:{fromWebContents:()=>win},sharedServices:registry,ownedSessions:{stop:()=>{throw Error('wrong owned route')}},stopObservedPlugin:()=>{throw Error('wrong plugin route')},stopGate:(_id:string,fn:()=>unknown)=>fn(),dialog:{showMessageBox:async(_win:unknown,opts:{detail:string})=>{detail=opts.detail;confirmations++;return {response:1}}},runtimeProjectLabels:()=>[],projectsSource:()=>[]}
 new Function(...Object.keys(deps),ts.transpileModule(block,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText)(...Object.values(deps))
 const frame={},event=(id:number)=>({senderFrame:frame,sender:{id,mainFrame:frame}})
 assert.equal((await handler(event(2),'voice-asr:fixture')).ok,false);assert.equal(confirmations,0)
 assert.equal((await handler(event(1),'voice-asr:fixture')).ok,true);assert.equal(confirmations,1);assert.equal(stops,1)
 assert.doesNotMatch(detail,/无活动项目引用/,'unknown ownership must not imply no active operation')
 exit()
})

test('runtime stop routes preview workers to owned registry, never plugin transport',async()=>{
 const source=readFileSync(new URL('./ipc.ts',import.meta.url),'utf8')
 const start=source.indexOf(" guardedHandle('runtime:stopPlugin'")
 const block=source.slice(start,source.indexOf(" let mode:",start))
 let handler:any,calls=0
 const deps={ipcMain:{handle:(_n:string,fn:any)=>handler=fn},guardedHandle:(_n:string,fn:any)=>handler=fn,BrowserWindow:{fromWebContents:()=>({isDestroyed:()=>false})},sharedServices:{stop:()=>{throw Error('wrong shared route')}},ownedSessions:{stop:async(id:string,windowId:number)=>{assert.equal(id,'voice-preview:8:1');assert.equal(windowId,8);calls++;return {ok:true}}},stopObservedPlugin:()=>({ok:false,reason:'wrong plugin route'}),stopGate:(_id:string,fn:()=>unknown)=>fn(),dialog:{},runtimeProjectLabels:()=>[],projectsSource:()=>[]}
 new Function(...Object.keys(deps),ts.transpileModule(block,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText)(...Object.values(deps))
 const frame={},event={senderFrame:frame,sender:{id:8,mainFrame:frame}}
 assert.equal((await handler(event,'voice-preview:8:1')).ok,true);assert.equal(calls,1)
})
