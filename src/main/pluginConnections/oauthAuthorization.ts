import {startAuthorization,exchangeAuthorization,refreshAuthorization} from '@modelcontextprotocol/sdk/client/auth.js'
import type {FetchLike} from '@modelcontextprotocol/sdk/shared/transport.js'
import {startOAuthCallback} from './oauthCallback.ts'
import {validateRemoteEndpoint} from './endpointPolicy.ts'

export interface PluginOAuthConfig {
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
export async function authorizePlugin(config:PluginOAuthConfig,deps:Dependencies) {
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

/** Refresh is a separate explicit operation, never a replay of a failed tools/call. */
export async function refreshPluginAuthorization(config:PluginOAuthConfig,refreshToken:string,deps:Pick<Dependencies,'fetch'|'signal'|'timeoutMs'>){
 const {issuer,resource,authorizationEndpoint,tokenEndpoint,clientId}=config
 const origins=[...config.approvedOrigins]
 for(const endpoint of [issuer,resource,authorizationEndpoint,tokenEndpoint])validateRemoteEndpoint(endpoint,origins)
 if(!clientId||!refreshToken)throw Error('需要重新授权')
 const controller=new AbortController(),forward=()=>controller.abort()
 deps.signal?.addEventListener('abort',forward,{once:true})
 if(deps.signal?.aborted)forward()
 const timer=setTimeout(()=>controller.abort(),deps.timeoutMs??60_000)
 let onAbort!:()=>void
 const cancelled=new Promise<never>((_resolve,reject)=>{
  onAbort=()=>reject(Error('刷新已取消或超时'))
  controller.signal.addEventListener('abort',onAbort,{once:true})
  if(controller.signal.aborted)onAbort()
 })
 const operation=async()=>{
  if(controller.signal.aborted)throw Error('cancelled')
  const result=await refreshAuthorization(new URL(issuer),{
   metadata:{issuer,authorization_endpoint:authorizationEndpoint,token_endpoint:tokenEndpoint,response_types_supported:['code'],code_challenge_methods_supported:['S256'],token_endpoint_auth_methods_supported:['none']},
   clientInformation:{client_id:clientId},refreshToken,resource:new URL(resource),
   fetchFn:async(input,init)=>{
    if(controller.signal.aborted||String(input)!==tokenEndpoint)throw Error('令牌目标或会话无效')
    return deps.fetch(input,{...init,signal:controller.signal,redirect:'manual',credentials:'omit'})
   }
  })
  if(controller.signal.aborted)throw Error('cancelled')
  return result
 }
 try{return await Promise.race([operation(),cancelled])}
 catch{throw Error('令牌刷新未完成，请重新连接账号')}
 finally{clearTimeout(timer);deps.signal?.removeEventListener('abort',forward);controller.signal.removeEventListener('abort',onAbort);controller.abort()}
}
