import {test} from 'node:test'
import assert from 'node:assert/strict'
import {DynamicAuthorizationManager} from './dynamicAuthorizationManager.ts'
import {CredentialLeases} from './credentialLease.ts'
const config={issuer:'https://auth.example.com',resource:'https://mcp.example.com/mcp',authorizationEndpoint:'https://auth.example.com/auth',tokenEndpoint:'https://auth.example.com/token',registrationEndpoint:'https://auth.example.com/register',approvedOrigins:['https://auth.example.com','https://mcp.example.com']}
function fixture(){
 const leases=new CredentialLeases(()=>true);let saved:any,starts=0,refreshes=0,client=''
 let finish!:(v:any)=>void
 const manager=new DynamicAuthorizationManager({plugin:'fixture',config,acquire:()=>({...leases.acquire(),seal:(v:string)=>v,open:(v:string)=>v}),store:{loadDynamicAuthorization:()=>saved,saveDynamicAuthorization:(_s,v)=>{saved=v},removeDynamicAuthorization:()=>{saved=undefined}},authorize:async()=>{starts++;return new Promise(r=>{finish=r})},refresh:async(c)=>{refreshes++;client=c.clientId;return {access_token:'new',token_type:'Bearer'}}})
 return {manager,leases,finish:()=>finish({clientId:'registered',tokens:{access_token:'old',refresh_token:'refresh',token_type:'Bearer'}}),state:()=>({saved,starts,refreshes,client})}
}
test('dynamic login coalesces, stores client with tokens and refresh reuses that identity without registering',async()=>{
 const f=fixture();const a=f.manager.login(),b=f.manager.login();await Promise.resolve();f.finish()
 assert.deepEqual(await a,{authorized:true});await b;assert.equal(f.state().starts,1)
 await f.manager.refresh();assert.equal(f.state().starts,1);assert.equal(f.state().client,'registered')
 assert.equal(f.state().saved.tokens.access_token,'new');assert.equal(f.state().saved.tokens.refresh_token,'refresh')
})
test('disconnect and lock each discard late dynamic authorization records',async()=>{
 for(const action of ['disconnect','lock','close']){
  const f=fixture(),pending=f.manager.login();await Promise.resolve()
  if(action==='disconnect')f.manager.disconnect();else if(action==='lock')f.leases.invalidate();else f.manager.close()
  f.finish();await assert.rejects(pending);assert.equal(f.state().saved,undefined)
 }
})
test('dynamic storage scope changes with approved endpoint configuration',()=>{
 const f=fixture();const another=new DynamicAuthorizationManager({plugin:'fixture',config:{...config,registrationEndpoint:config.registrationEndpoint+'/v2'},acquire:()=>{throw Error('unused')},store:{loadDynamicAuthorization:()=>undefined,saveDynamicAuthorization:()=>{},removeDynamicAuthorization:()=>{}},authorize:async()=>{throw Error('unused')},refresh:async()=>{throw Error('unused')}})
 assert.notEqual(f.manager.scope.account,another.scope.account)
})
test('missing refresh credentials never trigger registration, and closed managers reject login',async()=>{
 const f=fixture();await assert.rejects(f.manager.refresh());assert.equal(f.state().starts,0);assert.equal(f.state().refreshes,0)
 f.manager.close();await assert.rejects(f.manager.login());assert.equal(f.state().starts,0)
})
test('synchronous provider failures leave no poisoned pending operation',async()=>{
 const leases=new CredentialLeases(()=>true);let starts=0
 const manager=new DynamicAuthorizationManager({plugin:'fixture',config,acquire:()=>({...leases.acquire(),seal:(v:string)=>v,open:(v:string)=>v}),store:{loadDynamicAuthorization:()=>undefined,saveDynamicAuthorization:()=>{throw Error('unexpected write')},removeDynamicAuthorization:()=>{}},authorize:()=>{starts++;throw Error('provider secret must not escape')},refresh:async()=>{throw Error('unused')}})
 await assert.rejects(manager.login(),/动态授权未完成/);await assert.rejects(manager.login(),/动态授权未完成/);assert.equal(starts,2)
})
