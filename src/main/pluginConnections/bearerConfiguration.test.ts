import {test} from 'node:test'
import assert from 'node:assert/strict'
import {CredentialLeases} from './credentialLease.ts'
import * as bearer from './bearerConfiguration.ts'
import type {PluginInfo} from '../../shared/types'
const info:PluginInfo={name:'fixture',id:'eas:fixture',cli:'eas',root:'/fixture',displayName:'Fixture',remote:{transport:'streamable-http',url:'https://mcp.example.com/mcp',approvedOrigins:['https://mcp.example.com'],auth:'bearer',bearer:{field:'token'}},config:{fields:[{id:'token',type:'secret',label:'Token',purpose:'服务',required:true}]}}
test('stored bearer uses exact resource, does not refresh/replay 401, and lock cancels its connection',async()=>{
 const leases=new CredentialLeases(()=>true),sent:RequestInit[]=[]
 const connection=bearer.connectBearerConfiguration({info,lease:leases.acquire(),load:()=>({token:'fixture-token'}),fetch:async(_u,init)=>{sent.push(init!);return new Response(null,{status:401})}})
 for(const url of ['https://other.example.com/mcp',info.remote!.url+'?extra=1'])await assert.rejects(connection.fetch(url))
 await assert.rejects(connection.fetch(info.remote!.url,{headers:{authorization:'other'}}))
 assert.equal(sent.length,0)
 assert.equal((await connection.fetch(info.remote!.url,{method:'POST'})).status,401)
 assert.equal(sent.length,1);assert.equal(new Headers(sent[0].headers).get('authorization'),'Bearer fixture-token')
 leases.invalidate();assert.equal(sent[0].signal!.aborted,true)
 await assert.rejects(connection.fetch(info.remote!.url));assert.equal(sent.length,1)
 connection.close()
})
test('missing, malformed or changed secret fails closed before any network request',()=>{
 const cases:(Record<string,string>|undefined)[]=[undefined,{}, {token:'bad\r\nheader'}, {token:'x'.repeat(16385)}]
 for(const values of cases){
  const lease=new CredentialLeases(()=>true).acquire()
  assert.throws(()=>bearer.connectBearerConfiguration({info,lease,load:()=>values,fetch:async()=>{throw Error('must not send')}}));lease.dispose()
 }
})
