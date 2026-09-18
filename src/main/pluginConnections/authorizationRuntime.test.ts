import {test} from 'node:test'
import assert from 'node:assert/strict'
import * as implementation from './authorizationRuntime.ts'
import {CredentialLeases} from './credentialLease.ts'
import type {OAuthTokens} from '@modelcontextprotocol/sdk/shared/auth.js'
const config={issuer:'https://auth.example.com',resource:'https://mcp.example.com/mcp',authorizationEndpoint:'https://auth.example.com/authorize',tokenEndpoint:'https://auth.example.com/token',clientId:'fixture-client',approvedOrigins:['https://auth.example.com','https://mcp.example.com']}
function fixture(){
 const leases=new CredentialLeases(()=>true);let tokens:OAuthTokens|undefined,logins=0,sends=0
 const runtime=new implementation.PluginAuthorizationRuntime({plugin:'fixture',config,acquire:()=>({...leases.acquire(),seal:(v:string)=>v,open:(v:string)=>v}),store:{load:()=>tokens,save:(_s,v)=>{tokens=v},remove:()=>{tokens=undefined}},authorize:async()=>{logins++;return {access_token:'fixture',token_type:'Bearer',expires_in:3600}},refresh:async()=>({access_token:'refreshed',token_type:'Bearer'}),fetch:async()=>{sends++;return new Response()}})
 return {runtime,leases,counts:()=>({logins,sends})}
}
test('runtime requires explicit login, exposes status only, and disconnect invalidates all connection leases',async()=>{
 const f=fixture();assert.equal(f.runtime.status(),'disconnected');assert.throws(()=>f.runtime.connect())
 assert.equal(f.counts().logins,0);assert.deepEqual(await f.runtime.login(),{authorized:true});assert.equal(f.runtime.status(),'authorized')
 const a=f.runtime.connect(),b=f.runtime.connect();await a.fetch(config.resource)
 f.runtime.disconnect();assert.equal(a.signal.aborted,true);assert.equal(b.signal.aborted,true)
 assert.equal(f.runtime.status(),'disconnected');await assert.rejects(b.fetch(config.resource));assert.equal(f.counts().sends,1)
})
test('runtime vault lock propagates to active connections; close permanently forbids login',async()=>{
 const f=fixture();await f.runtime.login();const connection=f.runtime.connect()
 f.leases.invalidate();assert.equal(connection.signal.aborted,true)
 f.runtime.close();await assert.rejects(f.runtime.login());assert.throws(()=>f.runtime.connect())
})
