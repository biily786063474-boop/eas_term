import test from 'node:test'
import assert from 'node:assert/strict'
import {adviseTimeline} from './timeline.mjs'
const input={candidate:{id:'c',title:'修复预览',summary:'新增测试',review:'pending',secret:'not transmitted'},projects:[{id:'p1',name:'画板',cwd:'/private'}]}
test('timeline defaults are inert and results remain unaccepted suggestions',async()=>{
 let calls=0
 const runtime={snapshot:()=>({enabled:false,connected:false,selected:{}}),ask:async()=>{calls++}}
 assert.deepEqual(await adviseTimeline(runtime,input),{candidateId:'c',requiresReview:true});assert.equal(calls,0)
 runtime.snapshot=()=>({enabled:true,connected:true,selected:{milestone:true,project:true}})
 runtime.ask=async(key,request)=>{calls++;assert.equal(JSON.stringify(request).includes('/private'),false);assert.equal(JSON.stringify(request).includes('secret'),false);return key==='milestone'?{answers:{worthKeeping:{noul:.8}}}:{answers:{project:{choice:'p0',confidence:.9}}}}
 const result=await adviseTimeline(runtime,input);assert.equal(result.milestone.accepted,false);assert.equal(result.project.projectId,'p1');assert.equal(calls,2)
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
