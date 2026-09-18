import {test} from 'node:test'
import assert from 'node:assert/strict'
import * as actions from './authorizationActions.ts'
import type {PluginInfo} from '../../shared/types'
const plugin={id:'eas:fixture',name:'fixture',cli:'eas',displayName:'Fixture',remote:{transport:'streamable-http',url:'https://mcp.example.com/mcp',approvedOrigins:['https://mcp.example.com'],auth:'oauth',oauth:{issuer:'https://mcp.example.com',authorizationEndpoint:'https://mcp.example.com/auth',tokenEndpoint:'https://mcp.example.com/token',clientId:'fixture'}}} as PluginInfo
function setup(){let current:PluginInfo|undefined=plugin,accepted=true,logins=0,disconnects=0
 const api=actions.createAuthorizationActions({find:()=>current,runtime:()=>({status:()=> 'disconnected' as const,login:async()=>{logins++;return {authorized:true as const}},disconnect:()=>{disconnects++}}),confirm:async()=>accepted})
 return {api,replace:(p:PluginInfo|undefined)=>{current=p},deny:()=>{accepted=false},counts:()=>({logins,disconnects})}
}
test('authorization actions expose status only and require confirmed explicit login',async()=>{
 const f=setup();assert.deepEqual(await f.api('status',plugin.id),{ok:true,status:'disconnected'})
 f.deny();assert.equal((await f.api('login',plugin.id)).ok,false);assert.equal(f.counts().logins,0)
 const g=setup();assert.deepEqual(await g.api('login',plugin.id),{ok:true,status:'disconnected'});assert.equal(g.counts().logins,1)
 assert.equal((await g.api('disconnect',plugin.id)).ok,true);assert.equal(g.counts().disconnects,1)
 for(const id of [null,'eas:../escape','codex:fixture',{}])assert.equal((await g.api('login',id)).ok,false)
})
test('confirmation cannot authorize a changed manifest or disabled plugin',async()=>{
 let current=plugin,logins=0
 const api=actions.createAuthorizationActions({find:()=>current,runtime:()=>({status:()=> 'disconnected' as const,login:async()=>{logins++;return {authorized:true as const}},disconnect:()=>{}}),confirm:async()=>{current={...plugin,remote:{...plugin.remote!,url:'https://other.example/mcp'}};return true}})
 assert.equal((await api('login',plugin.id)).ok,false);assert.equal(logins,0)
 const f=setup();f.replace({...plugin,enabled:false});assert.equal((await f.api('login',plugin.id)).ok,false)
})
