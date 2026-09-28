import test from 'node:test'
import assert from 'node:assert/strict'
import {createService} from './service.mjs'
test('unconfigured service opens panel without network or key',async()=>{
 const s=createService({panel:'<html>onboarding</html>'})
 assert.equal((await s.handle('panel/state')).connected,false)
 assert.equal((await s.handle('resources/read',{uri:'ui://jev/panel'})).contents[0].text,'<html>onboarding</html>')
 assert.equal((await s.handle('tools/list')).tools.length,1)
 await assert.rejects(s.handle('tools/call',{name:'jev_triage',arguments:{}}),/disabled/)
})
test('no model tool may configure or grant consent',async()=>{
 const s=createService({panel:''})
 for(const name of ['connect','grant','panel/grant','jev_enable'])await assert.rejects(s.handle('tools/call',{name}),/Unknown/)
 await assert.rejects(s.handle('panel/grant',{action:'enable'}),/connection/)
})

test('stale catalog entries are checked again at call time',async()=>{
 const {createRuntime}=await import('./runtime.mjs')
 let calls=0
 const runtime=createRuntime({evaluate:async()=>{calls++;return {answers:{}}}})
 runtime.connect('fixture');runtime.enable()
 const s=createService({panel:'',runtime})
 assert.equal((await s.handle('tools/list')).tools.length,2)
 await s.handle('panel/grant',{action:'select',capability:'docs',enabled:false})
 await assert.rejects(s.handle('tools/call',{name:'jev_docs',arguments:{}}),/disabled/)
 assert.equal(calls,0)
 await s.handle('panel/revoke')
 assert.equal((await s.handle('tools/list')).tools.length,1)
 await assert.rejects(s.handle('panel/grant',{action:'unexpected'}),/Unknown/)
})

test('only host configuration verifies a synthetic request; success does not enable abilities',async()=>{
 let calls=0
 const s=createService({panel:'',verify:async(request,{key})=>{calls++;assert.equal(key,'fixture');assert.match(request.state,/No user data/);return {}}})
 await s.handle('host/configure',{configuration:JSON.stringify({'api-key':'fixture'})})
 assert.equal(calls,1);assert.equal((await s.handle('panel/state')).connected,true)
 assert.equal((await s.handle('panel/state')).enabled,false)
 assert.equal((await s.handle('tools/list')).tools.length,1)
 const failed=createService({panel:'',verify:async()=>{throw Error('failure')}})
 await assert.rejects(failed.handle('host/configure',{configuration:JSON.stringify({'api-key':'fixture'})}))
 assert.equal((await failed.handle('panel/state')).connected,false)
})

test('skills load on demand and disabled resources cannot bypass switches',async()=>{
 const s=createService({panel:'',skills:{triage:'focused instructions'}})
 await assert.rejects(s.handle('resources/read',{uri:'jev://skills/triage'}),/unavailable/)
 s.runtime.connect('fixture');s.runtime.enable()
 assert.equal((await s.handle('resources/read',{uri:'jev://skills/triage'})).contents[0].text,'focused instructions')
 assert.equal((await s.handle('resources/list')).resources.length,2)
 s.runtime.select('triage',false)
 await assert.rejects(s.handle('resources/read',{uri:'jev://skills/triage'}),/unavailable/)
})

test('ordinary LLM tools propagate cancellation and reject late results',async()=>{
 const {createRuntime}=await import('./runtime.mjs');let finish,providerSignal
 const runtime=createRuntime({evaluate:async(_request,{signal})=>{providerSignal=signal;return new Promise(resolve=>{finish=resolve})}})
 runtime.connect('fixture');runtime.enable()
 const service=createService({panel:'',runtime}),controller=new AbortController()
 const result=service.handle('tools/call',{name:'jev_custom',arguments:{state:'fixture',questions:{}},authorizationGeneration:runtime.snapshot().generation},{signal:controller.signal})
 controller.abort();assert.equal(providerSignal.aborted,true);finish({answers:{}})
 await assert.rejects(result,/revoked/)
})
test('trusted host restore restores persisted intent without paid verification',async()=>{
 const {createRuntime}=await import('./runtime.mjs')
 const {createPolicy}=await import('./policy.mjs')
 const runtime=createRuntime({preferences:{load:()=>({version:2,enabledIntent:true,selected:createPolicy().snapshot().selected}),save:()=>{}}})
 const s=createService({panel:'',runtime,verify:async()=>{throw Error('must not bill on restore')}})
 await s.handle('host/restore',{configuration:JSON.stringify({'api-key':'fixture'})})
 assert.equal(runtime.snapshot().enabled,true)
 assert.equal(runtime.snapshot().connected,true)
})
test('model decisions require exact host-approved generation',async()=>{
 const {createRuntime}=await import('./runtime.mjs');let calls=0
 const runtime=createRuntime({evaluate:async()=>{calls++;return {answers:{}}}})
 runtime.connect('fixture');runtime.enable();const s=createService({panel:'',runtime})
 await assert.rejects(s.handle('tools/call',{name:'jev_decide',arguments:{}}),/authorization/)
 const generation=runtime.snapshot().generation;runtime.pause();runtime.enable()
 await assert.rejects(s.handle('tools/call',{name:'jev_decide',arguments:{},authorizationGeneration:generation}),/authorization/)
 assert.equal(calls,0)
})
test('timeline host snapshot generation is checked before network dispatch',async()=>{
 const {createRuntime}=await import('./runtime.mjs');let calls=0
 const runtime=createRuntime({evaluate:async()=>{calls++;return {}}});runtime.connect('fixture');runtime.enable()
 const s=createService({panel:'',runtime}),generation=runtime.snapshot().generation
 runtime.select('milestone',true)
 await assert.rejects(s.handle('host/timeline',{authorizationGeneration:generation}),/authorization/)
 assert.equal(calls,0)
})
