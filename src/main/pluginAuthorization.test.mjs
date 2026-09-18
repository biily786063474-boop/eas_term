import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import {transformSync} from 'esbuild'
const source=transformSync(fs.readFileSync(new URL('./pluginAuthorization.ts',import.meta.url),'utf8'),{loader:'ts',format:'cjs'}).code
function fixture(){
 const events=[],instances=[],hooks=[];let discovered
 class Runtime{constructor(deps){this.deps=deps;instances.push(this)}close(){events.push('close')}login(){return this.deps.authorize(this.deps.config,new AbortController().signal)}}
 class Dynamic extends Runtime{}
 const oauth={issuer:'https://auth.example.com',authorizationEndpoint:'https://auth.example.com/authorize',tokenEndpoint:'https://auth.example.com/token',registrationEndpoint:'https://auth.example.com/register'}
 discovered={...oauth,resource:'https://mcp.example.com/mcp'}
 const modules={electron:{app:{isReady:()=>true,getPath:()=>'/tmp',on:(_event,fn)=>hooks.push(fn)},session:{defaultSession:{}},shell:{openExternal:async()=>events.push('browser')}},'node:fs':fs,'node:path':awaitPath,
 './secrets':{acquirePluginCredentialAccess:()=>{}},'./pluginConnections/credentialStore.ts':{PluginCredentialStore:class{}},'./pluginConnections/authorizationRuntime.ts':{PluginAuthorizationRuntime:Runtime},'./pluginConnections/dynamicAuthorizationRuntime.ts':{DynamicAuthorizationRuntime:Dynamic},
 './pluginConnections/pluginNetwork.ts':{createPluginNetwork:()=>async()=>{}},'./pluginConnections/oauthDiscovery.ts':{discoverPluginOAuth:async()=>{events.push('discovery');return discovered}},
 './pluginConnections/oauthAuthorization.ts':{authorizePlugin:async()=>{events.push('static')},authorizeDynamicPlugin:async(_config,deps)=>{events.push('register');await deps.openBrowser(oauth.authorizationEndpoint+'?state=test');return {clientId:'public',tokens:{access_token:'private',token_type:'Bearer'}}},refreshPluginAuthorization:async()=>{}}}
 const module={exports:{}};vm.runInNewContext(source,{module,exports:module.exports,require:id=>{if(!(id in modules))throw Error('Unexpected import '+id);return modules[id]},URL,AbortController})
 const info={name:'fixture',cli:'eas',remote:{transport:'streamable-http',url:'https://mcp.example.com/mcp',approvedOrigins:['https://auth.example.com','https://mcp.example.com'],auth:'oauth',oauth}}
 return {api:module.exports,info,events,instances,hooks,Dynamic,setDiscovery:value=>{discovered=value},discovered}
}
import awaitPath from 'node:path'
test('factory selects dynamic runtime, discovers before registration, reuses and invalidates configured instance',async()=>{
 const f=fixture(),runtime=f.api.getPluginAuthorization(f.info);assert.ok(runtime instanceof f.Dynamic)
 assert.equal(f.api.getPluginAuthorization(f.info),runtime);await runtime.login();assert.deepEqual(f.events,['discovery','register','browser'])
 f.api.getPluginAuthorization({...f.info,remote:{...f.info.remote,oauth:{...f.info.remote.oauth,scope:'read'}}});assert.equal(f.events.at(-1),'close')
 assert.equal(f.hooks.length,1);f.hooks[0]();assert.equal(f.events.at(-1),'close')
})
test('discovery mismatch, including same-origin path changes, never registers or opens browser',async()=>{
 for(const field of ['issuer','resource','authorizationEndpoint','tokenEndpoint','registrationEndpoint']){
  const f=fixture();f.setDiscovery({...f.discovered,[field]:'https://auth.example.com/changed'})
  await assert.rejects(f.api.getPluginAuthorization(f.info).login());assert.deepEqual(f.events,['discovery'])
 }
 const f=fixture();f.setDiscovery({...f.discovered,registrationEndpoint:undefined});await assert.rejects(f.api.getPluginAuthorization(f.info).login());assert.deepEqual(f.events,['discovery'])
})
test('fixed public clients retain static flow without discovery or registration',async()=>{
 const f=fixture();delete f.info.remote.oauth.registrationEndpoint;f.info.remote.oauth.clientId='fixed'
 const runtime=f.api.getPluginAuthorization(f.info);assert.ok(!(runtime instanceof f.Dynamic));await runtime.login();assert.deepEqual(f.events,['static'])
})
