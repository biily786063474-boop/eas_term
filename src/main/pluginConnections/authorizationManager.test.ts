import {test} from 'node:test'
import assert from 'node:assert/strict'
import {PluginAuthorizationManager} from './authorizationManager.ts'
import {CredentialLeases} from './credentialLease.ts'
const scope={plugin:'fixture',issuer:'https://auth.example.com',resource:'https://mcp.example.com',account:'test'}
const config={issuer:scope.issuer,resource:scope.resource,authorizationEndpoint:scope.issuer+'/authorize',tokenEndpoint:scope.issuer+'/token',clientId:'fixture',approvedOrigins:[scope.issuer,scope.resource]}
function fixture(){
 const leases=new CredentialLeases(()=>true);let writes=0,deletes=0,starts=0
 let finish!:(tokens:{access_token:string;token_type:string})=>void
 const manager=new PluginAuthorizationManager({
  acquire:()=>({...leases.acquire(),seal:(v:string)=>v,open:(v:string)=>v}),
  store:{save:()=>{writes++},remove:()=>{deletes++}},
  authorize:async()=>{starts++;return new Promise(r=>{finish=r})}
 })
 return {manager,leases,finish:()=>finish({access_token:'fixture',token_type:'Bearer'}),counts:()=>({writes,deletes,starts})}
}
test('same account login is single-flight and only returns status',async()=>{
 const f=fixture();const a=f.manager.login(scope,config),b=f.manager.login(scope,config)
 f.finish();assert.deepEqual(await a,{authorized:true});await b
 assert.deepEqual(f.counts(),{writes:1,deletes:0,starts:1})
})
test('disconnect prevents late authorization from recreating deleted credentials',async()=>{
 const f=fixture(),pending=f.manager.login(scope,config)
 f.manager.disconnect(scope);f.finish()
 await assert.rejects(pending);assert.deepEqual(f.counts(),{writes:0,deletes:1,starts:1})
})
test('vault lock invalidates pending login before encrypted commit',async()=>{
 const f=fixture(),pending=f.manager.login(scope,config)
 f.leases.invalidate();f.finish()
 await assert.rejects(pending);assert.equal(f.counts().writes,0)
})
test('synchronous authorize failure does not poison a future login',async()=>{
 const leases=new CredentialLeases(()=>true);let calls=0
 const manager=new PluginAuthorizationManager({acquire:()=>({...leases.acquire(),seal:(v:string)=>v,open:(v:string)=>v}),store:{save:()=>{},remove:()=>{}},authorize:()=>{calls++;throw Error('sync fixture')}})
 await assert.rejects(manager.login(scope,config));await assert.rejects(manager.login(scope,config));assert.equal(calls,2)
})
test('closed manager cannot start new authorization',async()=>{
 const f=fixture();f.manager.close()
 const result=f.manager.login(scope,config)
 if(f.counts().starts)f.finish()
 await assert.rejects(result);assert.equal(f.counts().starts,0)
})
