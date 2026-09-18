import {startAuthorization,exchangeAuthorization} from '@modelcontextprotocol/sdk/client/auth.js'
import type {FetchLike} from '@modelcontextprotocol/sdk/shared/transport.js'
import {startOAuthCallback} from './oauthCallback.ts'
import {validateRemoteEndpoint} from './endpointPolicy.ts'

interface Config {
 issuer:string;resource:string;authorizationEndpoint:string;tokenEndpoint:string
 clientId:string;approvedOrigins:readonly string[];scope?:string
}
interface Dependencies {
 /** Must be the pinned network adapter in production, never global fetch. */
 fetch:FetchLike
 /** Main-process system-browser opener; never renderer-controlled. */
 openBrowser:(url:string)=>Promise<void>
 signal?:AbortSignal;timeoutMs?:number
}
/** Explicitly pre-approved public-client endpoints only. No discovery, DCR, storage or refresh.
 * Tokens stay in main process. Production host integration must scope/lock their use.
 */
export async function authorizePlugin(config:Config,deps:Dependencies) {
 const {issuer,resource,authorizationEndpoint,tokenEndpoint,clientId,scope}=config
 const origins=[...config.approvedOrigins]
 for(const endpoint of [issuer,resource,authorizationEndpoint,tokenEndpoint])validateRemoteEndpoint(endpoint,origins)
 if(!clientId||clientId.length>2048)throw Error('OAuth客户端配置无效')
 if(deps.signal?.aborted)throw Error('授权已取消')
 const timeoutMs=deps.timeoutMs??180_000
 const flow=await startOAuthCallback({issuer,resource,timeoutMs})
 const controller=new AbortController()
 const forward=()=>controller.abort()
 deps.signal?.addEventListener('abort',forward,{once:true})
 if(deps.signal?.aborted)forward()
 const timer=setTimeout(()=>controller.abort(),timeoutMs)
 let onAbort!:()=>void
 const cancelled=new Promise<never>((_resolve,reject)=>{
  onAbort=()=>{flow.cancel();reject(Error('授权已取消或超时'))}
  controller.signal.addEventListener('abort',onAbort,{once:true})
  if(controller.signal.aborted)onAbort()
 })
 const assertActive=()=>{if(controller.signal.aborted)throw Error('授权已取消或超时')}
 const metadata={issuer,authorization_endpoint:authorizationEndpoint,token_endpoint:tokenEndpoint,response_types_supported:['code'],code_challenge_methods_supported:['S256'],token_endpoint_auth_methods_supported:['none']}
 const operation=async()=>{
  assertActive()
  const {authorizationUrl,codeVerifier}=await startAuthorization(new URL(issuer),{
   metadata,clientInformation:{client_id:clientId},redirectUrl:flow.redirectUri,state:flow.state,scope,resource:new URL(resource)
  })
  assertActive()
  await deps.openBrowser(authorizationUrl.href)
  assertActive()
  const callback=await flow.result
  assertActive()
  const tokens=await exchangeAuthorization(new URL(issuer),{
   metadata,clientInformation:{client_id:clientId},authorizationCode:callback.code,codeVerifier,
   redirectUri:flow.redirectUri,resource:new URL(resource),
   fetchFn:async(input,init)=>{
    assertActive()
    if(String(input)!==tokenEndpoint)throw Error('令牌目标不匹配')
    return deps.fetch(input,{...init,signal:controller.signal,redirect:'manual',credentials:'omit'})
   }
  })
  assertActive()
  return tokens
 }
 try{return await Promise.race([operation(),cancelled])}
 catch {throw Error(controller.signal.aborted?'授权已取消或超时':'授权未完成，请检查服务商配置或重新登录')}
 finally {
  clearTimeout(timer);deps.signal?.removeEventListener('abort',forward)
  controller.signal.removeEventListener('abort',onAbort)
  controller.abort();flow.cancel()
 }
}
