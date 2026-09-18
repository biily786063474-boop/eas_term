import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {startOAuthCallback} from './oauthCallback.ts'

test('loopback callback binds PKCE/state and consumes exactly once',async()=>{
 const flow=await startOAuthCallback({issuer:'https://auth.example.com',resource:'https://mcp.example.com',timeoutMs:1000})
 try{
  assert.equal(new URL(flow.redirectUri).hostname,'127.0.0.1')
  assert.equal(flow.challenge,createHash('sha256').update(flow.verifier).digest('base64url'))
  const bad=await fetch(flow.redirectUri+'?state=wrong&code=bad')
  assert.equal(bad.status,400)
  const response=await fetch(flow.redirectUri+'?state='+flow.state+'&code=fixture&iss='+encodeURIComponent('https://auth.example.com'))
  assert.equal(response.status,200)
  assert.deepEqual(await flow.result,{code:'fixture',issuer:'https://auth.example.com',resource:'https://mcp.example.com',redirectUri:flow.redirectUri,verifier:flow.verifier})
  await assert.rejects(fetch(flow.redirectUri+'?state='+flow.state+'&code=replay'))
 }finally{flow.cancel()}
})
test('issuer mismatch and duplicate parameters cannot consume callback',async()=>{
 const flow=await startOAuthCallback({issuer:'https://auth.example.com',resource:'https://mcp.example.com',timeoutMs:1000})
 const rejected=assert.rejects(flow.result,/取消/)
 try{
  for(const query of ['state='+flow.state+'&code=x&iss=https://evil.example','state='+flow.state+'&state='+flow.state+'&code=x']){
   assert.equal((await fetch(flow.redirectUri+'?'+query)).status,400)
  }
 }finally{flow.cancel()}
 await rejected
 await assert.rejects(fetch(flow.redirectUri))
})
test('timeout closes listener and rejects pending authorization',async()=>{
 const flow=await startOAuthCallback({issuer:'https://auth.example.com',resource:'https://mcp.example.com',timeoutMs:20})
 await assert.rejects(flow.result,/超时/)
 await assert.rejects(fetch(flow.redirectUri))
})
test('attempt captures issuer/resource rather than trusting mutable caller options',async()=>{
 const options={issuer:'https://auth.example.com',resource:'https://mcp.example.com',timeoutMs:1000}
 const flow=await startOAuthCallback(options)
 try{
  options.issuer='https://evil.example';options.resource='https://evil.example/mcp'
  const response=await fetch(flow.redirectUri+'?state='+flow.state+'&code=fixture&iss='+encodeURIComponent('https://auth.example.com'))
  assert.equal(response.status,200)
  assert.equal((await flow.result).resource,'https://mcp.example.com')
 }finally{flow.cancel()}
})
