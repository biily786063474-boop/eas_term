import test from 'node:test'
import assert from 'node:assert/strict'
import {adviseTimeline} from './timeline.mjs'
const input={candidate:{id:'c',title:'修复预览',summary:'新增测试',review:'pending',secret:'not transmitted'},projects:[{id:'p1',name:'画板',cwd:'/private'}]}
test('timeline defaults are inert and results remain unaccepted suggestions',async()=>{
 let calls=0
 const runtime={snapshot:()=>({enabled:false,connected:false,selected:{}}),ask:async()=>{calls++}}
 assert.deepEqual(await adviseTimeline(runtime,input),{candidateId:'c',requiresReview:true});assert.equal(calls,0)
 runtime.snapshot=()=>({enabled:true,connected:true,selected:{milestone:true,project:true}})
 runtime.ask=async(key,request)=>{calls++;assert.equal(JSON.stringify(request).includes('/private'),false);assert.equal(JSON.stringify(request).includes('secret'),false);return {answers:{worthKeeping:{noul:.8},project:{choice:'p0',confidence:.9}}}}
 const result=await adviseTimeline(runtime,input);assert.equal(result.milestone.accepted,false);assert.equal(result.project.projectId,'p1');assert.equal(calls,1)
 await assert.rejects(adviseTimeline(runtime,{...input,candidate:{...input.candidate,review:'confirmed'}}))
})

test('revoking timeline authorization cancels current provider call and prevents second paid request',async()=>{
 const {createRuntime}=await import('./runtime.mjs');let finish,calls=0,providerSignal
 const runtime=createRuntime({evaluate:async(_request,{signal})=>{calls++;providerSignal=signal;return await new Promise(resolve=>{finish=resolve})}})
 runtime.connect('fixture');runtime.selectAll(true);runtime.enable()
 const controller=new AbortController(),pending=adviseTimeline(runtime,input,{signal:controller.signal})
 controller.abort();assert.equal(providerSignal.aborted,true)
 finish({answers:{worthKeeping:{noul:.8}}})
 await assert.rejects(pending,/revoked/);assert.equal(calls,1)
})

test('low confidence abstains and source project does not ask model to guess',async()=>{
 let questions
 const runtime={snapshot:()=>({enabled:true,connected:true,selected:{project:true},automationScopes:{milestone:[],project:['p1']}}),ask:async(_key,request)=>{questions=request.questions;return {answers:{project:{choice:'p0',confidence:.2}}}}}
 assert.equal((await adviseTimeline(runtime,input)).project.projectId,null)
 questions=undefined
 const result=await adviseTimeline(runtime,{...input,sourceProjectId:'p1'})
 assert.equal(result.project.projectId,'p1');assert.equal(questions,undefined)
})
test('old host scope cannot send after recipe project permission changed',async()=>{
 let calls=0
 const runtime={snapshot:()=>({enabled:true,connected:true,selected:{milestone:true},automationScopes:{milestone:['other'],project:[]}}),ask:async()=>{calls++;return {answers:{worthKeeping:{noul:.8}}}}}
 await adviseTimeline(runtime,{...input,sourceProjectId:'p1',allowedCapabilities:{milestone:true}})
 assert.equal(calls,0)
})
