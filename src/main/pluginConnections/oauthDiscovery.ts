import type {FetchLike} from '@modelcontextprotocol/sdk/shared/transport.js'
import {validateRemoteEndpoint} from './endpointPolicy.ts'
interface Config {resource:string;issuer:string;approvedOrigins:readonly string[];resourceMetadataUrl?:string}
interface Dependencies {fetch:FetchLike;signal?:AbortSignal;timeoutMs?:number}
const record=(v:unknown):Record<string,unknown>=>{
 if(!v||typeof v!=='object'||Array.isArray(v))throw Error('OAuth元数据格式无效')
 return v as Record<string,unknown>
}
const includes=(v:unknown,wanted:string)=>Array.isArray(v)&&v.every(x=>typeof x==='string')&&v.includes(wanted)
/** Discovery foundation only: no registration/browser/token writes or automatic trust expansion.
 * Production callers must supply the pinned network adapter and already approved issuer/origins.
 */
export async function discoverPluginOAuth(config:Config,deps:Dependencies){
 const {resource,issuer,approvedOrigins}=config
 const r=validateRemoteEndpoint(resource,approvedOrigins),i=validateRemoteEndpoint(issuer,approvedOrigins)
 const controller=new AbortController(),forward=()=>controller.abort()
 deps.signal?.addEventListener('abort',forward,{once:true});if(deps.signal?.aborted)forward()
 const timer=setTimeout(forward,deps.timeoutMs??15_000)
 let onAbort!:()=>void
 const cancelled=new Promise<never>((_resolve,reject)=>{onAbort=()=>reject(Error('OAuth发现已取消或超时'));controller.signal.addEventListener('abort',onAbort,{once:true});if(controller.signal.aborted)onAbort()})
 const active=()=>{if(controller.signal.aborted)throw Error('OAuth发现已取消或超时')}
 const read=async(url:string):Promise<Record<string,unknown>|null>=>{
  active();validateRemoteEndpoint(url,approvedOrigins)
  const response=await deps.fetch(url,{method:'GET',headers:{accept:'application/json'},redirect:'manual',credentials:'omit',signal:controller.signal})
  active()
  if(response.status===404){await response.body?.cancel();return null}
  if(!response.ok||response.redirected){await response.body?.cancel();throw Error('OAuth元数据请求失败')}
  const reader=response.body?.getReader();if(!reader)throw Error('OAuth元数据为空')
  const chunks:Uint8Array[]=[];let size=0
  try{for(;;){active();const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>65536)throw Error('OAuth元数据超过64KB');chunks.push(value)}}finally{await reader.cancel();reader.releaseLock()}
  active();return record(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks))))
 }
 const first=async(urls:string[])=>{for(const url of [...new Set(urls)]){const doc=await read(url);if(doc)return doc}throw Error('未找到OAuth元数据')}
 const operation=async()=>{
  const resourceDocs=config.resourceMetadataUrl?[config.resourceMetadataUrl]:[
   r.origin+'/.well-known/oauth-protected-resource'+(r.pathname==='/'?'':r.pathname),r.origin+'/.well-known/oauth-protected-resource'
  ]
  const protectedResource=await first(resourceDocs)
  if(protectedResource.resource!==resource||!includes(protectedResource.authorization_servers,issuer))throw Error('OAuth资源或授权服务器不匹配')
  const suffix=i.pathname==='/'?'':i.pathname
  const metadata=await first([i.origin+'/.well-known/oauth-authorization-server'+suffix,i.origin+'/.well-known/openid-configuration'+suffix,issuer.replace(/\/$/,'')+'/.well-known/openid-configuration'])
  if(metadata.issuer!==issuer||!includes(metadata.response_types_supported,'code')||!includes(metadata.code_challenge_methods_supported,'S256')||!includes(metadata.token_endpoint_auth_methods_supported,'none'))throw Error('OAuth服务器不支持所需公共客户端安全流程')
  const endpoint=(name:string)=>{const value=metadata[name];if(typeof value!=='string')throw Error('OAuth端点缺失');validateRemoteEndpoint(value,approvedOrigins);return value}
  return {issuer,resource,authorizationEndpoint:endpoint('authorization_endpoint'),tokenEndpoint:endpoint('token_endpoint'),...(metadata.registration_endpoint!==undefined?{registrationEndpoint:endpoint('registration_endpoint')}:{}),clientIdMetadataDocumentSupported:metadata.client_id_metadata_document_supported===true}
 }
 try{return await Promise.race([operation(),cancelled])}
 finally{clearTimeout(timer);deps.signal?.removeEventListener('abort',forward);controller.signal.removeEventListener('abort',onAbort);controller.abort()}
}
