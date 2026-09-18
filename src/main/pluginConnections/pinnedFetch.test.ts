import {test} from 'node:test'
import assert from 'node:assert/strict'
import * as network from './pinnedFetch.ts'

test('fetch resolves once and passes pinned IP plus original Host and SNI to sender',async()=>{
 let calls=0
 const fetcher=network.createPinnedFetch({origins:['https://mcp.example.com'],resolve:async()=>{calls++;return ['8.8.8.8']},proxy:async()=> 'DIRECT',send:async(plan,init)=>{
  assert.equal(plan.address,'8.8.8.8');assert.equal(plan.servername,'mcp.example.com')
  assert.equal(new Headers(init.headers).get('host'),'mcp.example.com')
  return new Response('{}',{status:200})
 }})
 assert.equal((await fetcher('https://mcp.example.com/mcp',{method:'POST',body:'{}'})).status,200)
 assert.equal(calls,1)
})
test('no sender call for private DNS, credential headers, oversized body or foreign origin',async()=>{
 let sends=0
 const make=(addresses:string[])=>network.createPinnedFetch({origins:['https://mcp.example.com'],resolve:async()=>addresses,proxy:async()=> 'DIRECT',send:async()=>{sends++;return new Response('{}')}})
 await assert.rejects(make(['127.0.0.1'])('https://mcp.example.com/mcp'))
 for(const header of ['cookie','proxy-authorization','host'])await assert.rejects(make(['8.8.8.8'])('https://mcp.example.com/mcp',{headers:{[header]:'bad'}}))
 await assert.rejects(make(['8.8.8.8'])('https://mcp.example.com/mcp',{body:'a'.repeat(1024*1024+1)}))
 await assert.rejects(make(['8.8.8.8'])('https://evil.example/mcp'))
 assert.equal(sends,0)
})
test('redirect is rejected, never followed with Authorization',async()=>{
 let sends=0
 const f=network.createPinnedFetch({origins:['https://mcp.example.com'],resolve:async()=>['8.8.8.8'],proxy:async()=> 'DIRECT',send:async()=>{sends++;return new Response(null,{status:302,headers:{location:'https://evil.example/'}})}})
 await assert.rejects(f('https://mcp.example.com/mcp',{headers:{authorization:'Bearer fixture'}}),/跳转/)
 assert.equal(sends,1)
})

test('abort during DNS/PAC rejects promptly and late resolution never sends',async()=>{
 let release!:(value:string[])=>void
 let sends=0
 const pending=new Promise<string[]>(r=>{release=r})
 const controller=new AbortController()
 const f=network.createPinnedFetch({origins:['https://mcp.example.com'],resolve:()=>pending,proxy:async()=> 'DIRECT',send:async()=>{sends++;return new Response('{}')}})
 const result=f('https://mcp.example.com/mcp',{signal:controller.signal}).then(()=> 'sent',()=> 'aborted')
 controller.abort()
 const outcome=await Promise.race([result,new Promise(resolve=>setTimeout(()=>resolve('hung'),50))])
 release(['8.8.8.8'])
 await result
 assert.equal(outcome,'aborted')
 assert.equal(sends,0)
})
test('DNS/PAC preparation has a bounded deadline',async()=>{
 let sends=0
 const f=network.createPinnedFetch({origins:['https://mcp.example.com'],preparationTimeoutMs:10,resolve:()=>new Promise(()=>{}),proxy:async()=> 'DIRECT',send:async()=>{sends++;return new Response('{}')}})
 const outcome=await Promise.race([f('https://mcp.example.com/mcp').then(()=> 'sent',e=>String(e)),new Promise(resolve=>setTimeout(()=>resolve('hung'),60))])
 assert.match(String(outcome),/解析超时/)
 assert.equal(sends,0)
})
