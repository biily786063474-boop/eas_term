import test from 'node:test'
import assert from 'node:assert/strict'
import {activateDeferredConfiguration} from './deferredConfiguration.ts'
function fixture(){
 const abort=new AbortController();let closed=0,stops=0,finish!:()=>void
 const stopped=new Promise<void>(resolve=>{finish=resolve})
 const lease={environment:'private-key',signal:abort.signal,close:()=>{closed++}}
 return {abort,lease,finish,get closed(){return closed},get stops(){return stops},deps:{connect:()=>lease,request:async()=>({}),valid:()=>true,stop:()=>{stops++},stopped}}
}
test('activation holds live lease until exact process exits; key is not returned',async()=>{
 const f=fixture();let received:unknown
 assert.equal(await activateDeferredConfiguration({...f.deps,request:async(method,params)=>{assert.equal(method,'host/configure');received=params;return {secret:'never-forward'}}}),undefined)
 assert.deepEqual(received,{configuration:'private-key'});assert.equal(f.lease.environment,'');assert.equal(f.closed,0)
 f.abort.abort();assert.equal(f.stops,1);f.finish();await Promise.resolve();assert.equal(f.closed,1)
})
test('late verification cannot revive revoked lease and diagnostics are sanitized',async()=>{
 const f=fixture()
 await assert.rejects(activateDeferredConfiguration({...f.deps,request:async()=>{f.abort.abort();return {}}}),/授权已失效/)
 assert.equal(f.closed,1);assert.equal(f.lease.environment,'')
 const g=fixture()
 await assert.rejects(activateDeferredConfiguration({...g.deps,request:async()=>{throw Error('private-key')}}),error=>!String(error).includes('private-key'))
 assert.equal(g.closed,1);assert.equal(g.stops,1)
})
test('known connection remediation is preserved but appended secrets are never forwarded',async()=>{
 const message='TypeSafe 密钥无效或已失效，请在安全连接设置中更新密钥。'
 const f=fixture()
 await assert.rejects(activateDeferredConfiguration({...f.deps,request:async()=>{throw Error(message)}}),e=>e instanceof Error&&e.message===message)
 const g=fixture()
 await assert.rejects(activateDeferredConfiguration({...g.deps,request:async()=>{throw Error(message+' private-key')}}),e=>!String(e).includes('private-key'))
})
test('restore uses distinct trusted method and verification marker follows validity check',async()=>{
 const f=fixture();let marked=0
 await activateDeferredConfiguration({...f.deps,mode:'restore',verified:()=>{marked++},request:async method=>{assert.equal(method,'host/restore')}})
 assert.equal(marked,0)
 const g=fixture()
 await activateDeferredConfiguration({...g.deps,verified:environment=>{assert.equal(environment,'private-key');marked++}})
 assert.equal(marked,1)
 const h=fixture()
 await assert.rejects(activateDeferredConfiguration({...h.deps,verified:()=>{marked++},request:async()=>{h.abort.abort()}}))
 assert.equal(marked,1)
})
