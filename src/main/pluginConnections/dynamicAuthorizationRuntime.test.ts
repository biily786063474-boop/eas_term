import {test} from 'node:test'
import assert from 'node:assert/strict'
import {DynamicAuthorizationRuntime} from './dynamicAuthorizationRuntime.ts'
import {CredentialLeases} from './credentialLease.ts'
import type {OAuthTokens} from '@modelcontextprotocol/sdk/shared/auth.js'
const config={issuer:'https://auth.example.com',resource:'https://mcp.example.com/mcp',authorizationEndpoint:'https://auth.example.com/authorize',tokenEndpoint:'https://auth.example.com/token',registrationEndpoint:'https://auth.example.com/register',approvedOrigins:['https://auth.example.com','https://mcp.example.com']}
function fixture(){
 const leases=new CredentialLeases(()=>true);let record:{clientId:string;tokens:OAuthTokens}|undefined,logins=0,sends=0,refreshes=0
 const runtime=new DynamicAuthorizationRuntime({plugin:'fixture',config,acquire:()=>({...leases.acquire(),seal:(v:string)=>v,open:(v:string)=>v}),store:{loadDynamicAuthorization:()=>record,saveDynamicAuthorization:(_s,v)=>{record=v},removeDynamicAuthorization:()=>{record=undefined}},authorize:async()=>{logins++;return {clientId:'registered',tokens:{access_token:'fixture',token_type:'Bearer',refresh_token:'refresh',expires_in:10}}},refresh:async c=>{assert.equal(c.clientId,'registered');refreshes++;return {access_token:'refreshed',token_type:'Bearer',expires_in:3600}},fetch:async(_input,init)=>{sends++;assert.equal(new Headers(init?.headers).get('authorization'),'Bearer refreshed');return new Response(null,{status:401})}})
 return {runtime,leases,counts:()=>({logins,sends,refreshes})}
}
test('dynamic connection refreshes with persisted client identity and never replays a 401',async()=>{
 const f=fixture();assert.equal(f.runtime.status(),'disconnected');assert.throws(()=>f.runtime.connect())
 assert.deepEqual(await f.runtime.login(),{authorized:true});const c=f.runtime.connect()
 await assert.rejects(c.fetch('https://evil.example/mcp'));assert.equal(f.counts().sends,0)
 assert.equal((await c.fetch(config.resource)).status,401)
 assert.deepEqual(f.counts(),{logins:1,sends:1,refreshes:1})
 f.runtime.close()
})
test('disconnect, lock and close each terminate all active dynamic connections',async()=>{
 for(const action of ['disconnect','lock','close']){
  const f=fixture();await f.runtime.login();const a=f.runtime.connect(),b=f.runtime.connect()
  if(action==='disconnect')f.runtime.disconnect();else if(action==='lock')f.leases.invalidate();else f.runtime.close()
  assert.ok(a.signal.aborted&&b.signal.aborted);await assert.rejects(a.fetch(config.resource));assert.equal(f.counts().sends,0)
  if(action==='close'){await assert.rejects(f.runtime.login());assert.throws(()=>f.runtime.connect())}
 }
})
test('dynamic runtime reloads client identity from actual encrypted files before refreshing',async t=>{
 const fs=await import('node:fs'),os=await import('node:os'),path=await import('node:path'),crypto=await import('node:crypto')
 const {PluginCredentialStore}=await import('./credentialStore.ts')
 const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'dynamic-runtime-')));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}))
 const key=crypto.randomBytes(32),leases=new CredentialLeases(()=>true)
 const acquire=()=>({...leases.acquire(),seal:(text:string)=>{const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,iv),body=Buffer.concat([cipher.update(text),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),body]).toString('base64')},open:(text:string)=>{const b=Buffer.from(text,'base64'),decipher=crypto.createDecipheriv('aes-256-gcm',key,b.subarray(0,12));decipher.setAuthTag(b.subarray(12,28));return Buffer.concat([decipher.update(b.subarray(28)),decipher.final()]).toString()}})
 let registrations=0
 const deps={plugin:'fixture',config,acquire,store:new PluginCredentialStore(dir),authorize:async()=>{registrations++;return {clientId:'disk-client',tokens:{access_token:'old-secret',refresh_token:'refresh-secret',token_type:'Bearer',expires_in:0}}},refresh:async(c:{clientId:string},token:string)=>{assert.equal(c.clientId,'disk-client');assert.equal(token,'refresh-secret');return {access_token:'new-secret',token_type:'Bearer',expires_in:3600}},fetch:async(_input:unknown,init?:RequestInit)=>{assert.equal(new Headers(init?.headers).get('authorization'),'Bearer new-secret');return new Response()}}
 const first=new DynamicAuthorizationRuntime(deps);await first.login();first.close()
 const restored=new DynamicAuthorizationRuntime({...deps,store:new PluginCredentialStore(dir)});assert.equal(restored.status(),'expired')
 await restored.connect().fetch(config.resource);assert.equal(registrations,1)
 for(const file of fs.readdirSync(dir))assert.doesNotMatch(fs.readFileSync(path.join(dir,file),'utf8'),/secret|disk-client/)
 restored.disconnect();assert.equal(fs.readdirSync(dir).length,0)
})
