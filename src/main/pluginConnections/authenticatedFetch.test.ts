import {test} from 'node:test'
import assert from 'node:assert/strict'
import * as implementation from './authenticatedFetch.ts'
import {CredentialLeases} from './credentialLease.ts'
import type {OAuthTokens} from '@modelcontextprotocol/sdk/shared/auth.js'
const url='https://mcp.example.com/mcp'
function fixture(tokens:OAuthTokens|undefined={access_token:'fixture-token',token_type:'Bearer',expires_in:300}){
 const leases=new CredentialLeases(()=>true),lease=leases.acquire()
 const sent:RequestInit[]=[];let refreshes=0
 const connection=implementation.createAuthenticatedFetch({url,lease,load:()=>tokens,refresh:async()=>{refreshes++;tokens={access_token:'refreshed',token_type:'Bearer',expires_in:300}},fetch:async(_input,init)=>{sent.push(init!);return new Response('denied',{status:401})}})
 return {connection,leases,sent,refreshes:()=>refreshes}
}
test('bearer is sent only to exact resource, cannot be caller-supplied and 401 is not replayed',async()=>{
 const f=fixture()
 for(const target of ['https://evil.example.com/mcp',url+'/other',url+'?token=1'])await assert.rejects(f.connection.fetch(target))
 await assert.rejects(f.connection.fetch(new Request(url)))
 await assert.rejects(f.connection.fetch(url,{headers:{authorization:'injected'}}))
 assert.equal(f.sent.length,0)
 assert.equal((await f.connection.fetch(url,{method:'POST',body:'tools/call'})).status,401)
 assert.equal(f.sent.length,1);assert.equal(new Headers(f.sent[0].headers).get('authorization'),'Bearer fixture-token')
 assert.equal(f.refreshes(),0);f.connection.close()
})
test('expired token is refreshed before dispatch and never causes implicit browser login',async()=>{
 const f=fixture({access_token:'expired',token_type:'Bearer',expires_in:0,refresh_token:'refresh'})
 await f.connection.fetch(url)
 assert.equal(f.refreshes(),1);assert.equal(new Headers(f.sent[0].headers).get('authorization'),'Bearer refreshed')
 f.connection.close()
 for(const tokens of [undefined,{access_token:'x',token_type:'Basic'},{access_token:'bad\r\nheader',token_type:'Bearer'}]){
  const lease=new CredentialLeases(()=>true).acquire();let sends=0
  const c=implementation.createAuthenticatedFetch({url,lease,load:()=>tokens,refresh:async()=>{throw Error('no login')},fetch:async()=>{sends++;return new Response()}})
  await assert.rejects(c.fetch(url));assert.equal(sends,0);c.close()
 }
})
test('vault invalidation cancels in-flight transport and permanently rejects future requests',async()=>{
 const f=fixture();await f.connection.fetch(url)
 const signal=f.sent[0].signal!;assert.equal(signal.aborted,false)
 f.leases.invalidate();assert.equal(signal.aborted,true);assert.equal(f.connection.signal.aborted,true)
 await assert.rejects(f.connection.fetch(url));assert.equal(f.sent.length,1)
})
test('close while refreshing prevents late tokens from dispatching a request',async()=>{
 const lease=new CredentialLeases(()=>true).acquire();let finish!:()=>void,sends=0
 const c=implementation.createAuthenticatedFetch({url,lease,load:()=>({access_token:'old',token_type:'Bearer',expires_in:0}),refresh:()=>new Promise<void>(r=>{finish=r}),fetch:async()=>{sends++;return new Response()}})
 const pending=c.fetch(url);c.close();finish();await assert.rejects(pending);assert.equal(sends,0)
})
