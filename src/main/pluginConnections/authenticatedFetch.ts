import type {FetchLike} from '@modelcontextprotocol/sdk/shared/transport.js'
import type {OAuthTokens} from '@modelcontextprotocol/sdk/shared/auth.js'
import {validateRemoteEndpoint} from './endpointPolicy.ts'
interface Dependencies {
 url:string
 lease:{signal:AbortSignal;assertActive():void;dispose():void}
 load:()=>OAuthTokens|undefined
 /** Serialized refresh in the authorization manager; never opens a browser. */
 refresh:()=>Promise<unknown>
 /** Production must supply the pinned network adapter. */
 fetch:FetchLike
}
/** A connection-scoped bearer boundary. No tokens escape to renderer or CLI config.
 * Refresh only precedes dispatch. A response, including 401, is never replayed.
 * Keep the lease signal alive after headers: response SSE streams need cancellation too.
 */
export function createAuthenticatedFetch(deps:Dependencies){
 const url=validateRemoteEndpoint(deps.url,[new URL(deps.url).origin]).href
 const controller=new AbortController()
 const signal=AbortSignal.any([controller.signal,deps.lease.signal])
 const active=()=>{deps.lease.assertActive();if(signal.aborted)throw Error('插件授权连接已关闭')}
 const fetch=async(input:string|URL|Request,init:RequestInit={}):Promise<Response>=>{
  active()
  if(input instanceof Request||String(input)!==url)throw Error('插件凭证只能发送到已授权资源')
  const headers=new Headers(init.headers)
  if(headers.has('authorization'))throw Error('插件不能覆盖宿主授权头')
  const requestSignal=init.signal?AbortSignal.any([signal,init.signal]):signal
  if(requestSignal.aborted)throw Error('插件请求已取消')
  let tokens=deps.load()
  if(!tokens)throw Error('请先连接插件账号')
  if(tokens.expires_in!==undefined&&tokens.expires_in<=30){
   await deps.refresh();active()
   if(requestSignal.aborted)throw Error('插件请求已取消')
   tokens=deps.load()
  }
  if(!tokens||tokens.expires_in!==undefined&&tokens.expires_in<=0)throw Error('插件授权已过期，请重新连接')
  if(tokens.token_type.toLowerCase()!=='bearer'||! /^[A-Za-z0-9\-._~+/]+=*$/.test(tokens.access_token))throw Error('插件令牌格式不支持')
  headers.set('authorization','Bearer '+tokens.access_token)
  active()
  return deps.fetch(input,{...init,headers,signal:requestSignal,credentials:'omit',redirect:'manual'})
 }
 return {fetch,signal,close:()=>{controller.abort();deps.lease.dispose()}}
}
