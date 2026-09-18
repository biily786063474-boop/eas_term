import {test} from 'node:test'
import assert from 'node:assert/strict'
import {discoverPluginOAuth} from './oauthDiscovery.ts'
const resource='https://mcp.example.com/mcp',issuer='https://auth.example.com/tenant'
const config={resource,issuer,approvedOrigins:['https://mcp.example.com','https://auth.example.com']}
const metadata={issuer,authorization_endpoint:issuer+'/authorize',token_endpoint:issuer+'/token',registration_endpoint:issuer+'/register',response_types_supported:['code'],code_challenge_methods_supported:['S256'],token_endpoint_auth_methods_supported:['none']}
test('discovery binds exact resource and issuer and uses path-aware OIDC fallback',async()=>{
 const calls:string[]=[]
 const result=await discoverPluginOAuth(config,{fetch:async(input,init)=>{
  const url=String(input);calls.push(url);assert.equal(init?.credentials,'omit');assert.equal(init?.redirect,'manual');assert.equal(new Headers(init?.headers).has('authorization'),false)
  if(url.includes('oauth-protected-resource'))return Response.json({resource,authorization_servers:[issuer]})
  if(url.includes('oauth-authorization-server'))return new Response(null,{status:404})
  return Response.json(metadata)
 }})
 assert.equal(result.registrationEndpoint,issuer+'/register')
 assert.deepEqual(calls,[ 'https://mcp.example.com/.well-known/oauth-protected-resource/mcp','https://auth.example.com/.well-known/oauth-authorization-server/tenant','https://auth.example.com/.well-known/openid-configuration/tenant'])
})
test('discovery rejects changed audience, issuer, endpoint, and PKCE before any registration',async()=>{
 for(const mutation of [{issuer:'https://evil.example'}, {token_endpoint:'https://evil.example/token'}, {code_challenge_methods_supported:['plain']}, {token_endpoint_auth_methods_supported:['client_secret_basic']}]){
  await assert.rejects(discoverPluginOAuth(config,{fetch:async input=>String(input).includes('oauth-protected-resource')?Response.json({resource,authorization_servers:[issuer]}):Response.json({...metadata,...mutation})}))
 }
 for(const doc of [{resource:resource+'/other',authorization_servers:[issuer]},{resource,authorization_servers:['https://evil.example']}]){
  let calls=0;await assert.rejects(discoverPluginOAuth(config,{fetch:async()=>{calls++;return Response.json(doc)}}));assert.equal(calls,1)
 }
})
test('discovery never follows redirects, oversized metadata or malformed successful metadata',async()=>{
 for(const response of [new Response(null,{status:302}),new Response('x'.repeat(65537)),Response.json({})]){
  let calls=0;await assert.rejects(discoverPluginOAuth(config,{fetch:async()=>{calls++;return response}}));assert.equal(calls,1)
 }
})
test('discovery cancellation detaches hung fetch without starting another request',async()=>{
 const controller=new AbortController();let calls=0
 const pending=discoverPluginOAuth(config,{signal:controller.signal,fetch:async()=>{calls++;return new Promise(()=>{})}})
 controller.abort();await assert.rejects(pending);assert.equal(calls,1)
})
test('resource root fallback is allowed only after missing path metadata',async()=>{
 const calls:string[]=[]
 const result=await discoverPluginOAuth(config,{fetch:async input=>{
  const url=String(input);calls.push(url)
  if(url.endsWith('oauth-protected-resource/mcp'))return new Response(null,{status:404})
  if(url.endsWith('oauth-protected-resource'))return Response.json({resource,authorization_servers:[issuer]})
  return Response.json(metadata)
 }})
 assert.equal(result.issuer,issuer);assert.equal(calls[1],'https://mcp.example.com/.well-known/oauth-protected-resource')
})
test('unapproved metadata hints and already cancelled flows issue no requests',async()=>{
 let calls=0;const fetch=async()=>{calls++;return Response.json({})}
 await assert.rejects(discoverPluginOAuth({...config,resourceMetadataUrl:'https://evil.example/metadata'},{fetch}))
 const controller=new AbortController();controller.abort()
 await assert.rejects(discoverPluginOAuth(config,{fetch,signal:controller.signal}));assert.equal(calls,0)
})
