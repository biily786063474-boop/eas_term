import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {authorizePlugin} from './oauthAuthorization.ts'
const config={issuer:'https://auth.example.com',resource:'https://mcp.example.com/mcp',authorizationEndpoint:'https://auth.example.com/authorize',tokenEndpoint:'https://auth.example.com/token',clientId:'fixture-client',approvedOrigins:['https://auth.example.com','https://mcp.example.com']}
async function callback(url:URL){
 const redirect=new URL(url.searchParams.get('redirect_uri')!)
 redirect.searchParams.set('state',url.searchParams.get('state')!);redirect.searchParams.set('code','fixture-code');redirect.searchParams.set('iss',config.issuer)
 assert.equal((await fetch(redirect)).status,200)
}
test('SDK authorization and exchange share one PKCE verifier and exact resource/redirect',async()=>{
 let authUrl!:URL,calls=0
 const result=await authorizePlugin(config,{openBrowser:async url=>{authUrl=new URL(url);await callback(authUrl)},fetch:async(input,init)=>{
  calls++;assert.equal(String(input),config.tokenEndpoint)
  const body=new URLSearchParams(String(init?.body))
  assert.equal(body.get('code'),'fixture-code');assert.equal(body.get('resource'),config.resource)
  assert.equal(body.get('redirect_uri'),authUrl.searchParams.get('redirect_uri'))
  assert.equal(createHash('sha256').update(body.get('code_verifier')!).digest('base64url'),authUrl.searchParams.get('code_challenge'))
  assert.equal(authUrl.searchParams.get('code_challenge_method'),'S256')
  return Response.json({access_token:'fixture-token',token_type:'Bearer'})
 }})
 assert.equal(result.access_token,'fixture-token');assert.equal(calls,1)
})
test('unapproved token destination is rejected before browser or fetch',async()=>{
 let calls=0
 await assert.rejects(authorizePlugin({...config,tokenEndpoint:'https://evil.example/token'},{openBrowser:async()=>{calls++},fetch:async()=>{calls++;return Response.json({})}}))
 assert.equal(calls,0)
})
test('cancel during token exchange rejects immediately and discards late tokens',async()=>{
 const controller=new AbortController();let release!:(r:Response)=>void
 let started!:()=>void;const ready=new Promise<void>(r=>{started=r})
 const result=authorizePlugin(config,{signal:controller.signal,openBrowser:async url=>callback(new URL(url)),fetch:async(_url,init)=>{
  assert.ok(init?.signal);started();return new Promise<Response>(r=>{release=r})
 }})
 await ready;controller.abort()
 const outcome=await Promise.race([result.then(()=> 'accepted',()=> 'cancelled'),new Promise(r=>setTimeout(()=>r('hung'),100))])
 release(Response.json({access_token:'late-fixture-token',token_type:'Bearer'}))
 assert.equal(outcome,'cancelled');await assert.rejects(result)
})
test('failed token POST is never retried and provider response is not exposed',async()=>{
 let calls=0
 await assert.rejects(authorizePlugin(config,{openBrowser:async url=>callback(new URL(url)),fetch:async()=>{calls++;return Response.json({error:'server_error',error_description:'sensitive-fixture-value'},{status:503})}}),error=>{
  assert.doesNotMatch(String(error),/sensitive-fixture-value/);return true
 })
 assert.equal(calls,1)
})
test('authorization exchanges a code with a real isolated HTTP token server',async t=>{
 const {createServer}=await import('node:http')
 let body=''
 const server=createServer((req,res)=>{
  assert.equal(req.method,'POST');assert.equal(req.url,'/token')
  req.on('data',chunk=>{body+=chunk})
  req.on('end',()=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({access_token:'local-fixture-token',token_type:'Bearer'}))})
 })
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r))
 t.after(()=>{server.closeAllConnections();server.close()})
 const address=server.address() as import('node:net').AddressInfo
 const tokens=await authorizePlugin(config,{
  openBrowser:async url=>callback(new URL(url)),
  // Test-only rewrite; production network rejects loopback destinations.
  fetch:async(input,init)=>{assert.equal(String(input),config.tokenEndpoint);return fetch('http://127.0.0.1:'+address.port+'/token',init)}
 })
 assert.equal(tokens.access_token,'local-fixture-token')
 assert.equal(new URLSearchParams(body).get('client_id'),config.clientId)
 assert.equal(new URLSearchParams(body).get('grant_type'),'authorization_code')
})
test('SDK refresh uses only the approved token endpoint and preserves refresh token',async()=>{
 const {refreshPluginAuthorization}=await import('./oauthAuthorization.ts')
 let calls=0
 const result=await refreshPluginAuthorization(config,'fixture-refresh',{fetch:async(input,init)=>{
  calls++;assert.equal(String(input),config.tokenEndpoint)
  const body=new URLSearchParams(String(init?.body));assert.equal(body.get('grant_type'),'refresh_token');assert.equal(body.get('refresh_token'),'fixture-refresh');assert.equal(body.get('resource'),config.resource)
  return Response.json({access_token:'renewed-fixture',token_type:'Bearer',expires_in:120})
 }})
 assert.equal(calls,1);assert.equal(result.refresh_token,'fixture-refresh')
})

test('dynamic public-client registration shares exact callback and PKCE with token exchange',async()=>{
 const {authorizeDynamicPlugin}=await import('./oauthAuthorization.ts')
 let registeredRedirect='',registered=false,authUrl!:URL
 const result=await authorizeDynamicPlugin({...config,registrationEndpoint:config.issuer+'/register'}, {
  openBrowser:async url=>{authUrl=new URL(url);assert.equal(authUrl.searchParams.get('client_id'),'new-public-client');await callback(authUrl)},
  fetch:async(input,init)=>{
   if(String(input)===config.issuer+'/register'){
    assert.equal(registered,false);registered=true
    const body=JSON.parse(String(init?.body));registeredRedirect=body.redirect_uris[0]
    assert.equal(body.token_endpoint_auth_method,'none');assert.equal(body.client_name,'Eas-Term')
    return Response.json({...body,client_id:'new-public-client'},{status:201})
   }
   const body=new URLSearchParams(String(init?.body));assert.equal(body.get('client_id'),'new-public-client');assert.equal(body.get('redirect_uri'),registeredRedirect)
   assert.equal(createHash('sha256').update(body.get('code_verifier')!).digest('base64url'),authUrl.searchParams.get('code_challenge'))
   return Response.json({access_token:'dynamic-token',token_type:'Bearer'})
  }
 })
 assert.equal(result.clientId,'new-public-client');assert.equal(result.tokens.access_token,'dynamic-token')
})
test('dynamic registration rejects client secrets and changed callback without opening browser',async()=>{
 const {authorizeDynamicPlugin}=await import('./oauthAuthorization.ts')
 for(const changes of [{client_secret:'not-public'},{redirect_uris:['https://evil.example/callback']},{token_endpoint_auth_method:'client_secret_post'}]){
  let opened=false
  await assert.rejects(authorizeDynamicPlugin({...config,registrationEndpoint:config.issuer+'/register'}, {openBrowser:async()=>{opened=true},fetch:async(_input,init)=>Response.json({...JSON.parse(String(init?.body)),client_id:'id',...changes},{status:201})}))
  assert.equal(opened,false)
 }
})
test('dynamic registration timeout/cancel does not retry or open browser after a late response',async()=>{
 const {authorizeDynamicPlugin}=await import('./oauthAuthorization.ts')
 const controller=new AbortController();let calls=0,opened=0,release!:(r:Response)=>void,started!:()=>void
 const ready=new Promise<void>(r=>{started=r})
 const pending=authorizeDynamicPlugin({...config,registrationEndpoint:config.issuer+'/register'},{signal:controller.signal,openBrowser:async()=>{opened++},fetch:async()=>{calls++;started();return new Promise(r=>{release=r})}})
 await ready;controller.abort();await assert.rejects(pending)
 release(Response.json({client_id:'late'},{status:201}));await new Promise(r=>setTimeout(r,10))
 assert.equal(calls,1);assert.equal(opened,0)
})
