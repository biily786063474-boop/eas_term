import {validateRemoteEndpoint,validatePublicAddresses} from './endpointPolicy.ts'
export interface ConnectionPlan {url:URL; address:string; servername:string; proxy?:URL}
/** Proxy decisions come from the trusted OS session, never a plugin or renderer field. */
export function planConnection(raw:string,origins:readonly string[],addresses:readonly string[],systemProxy:string):ConnectionPlan {
 const url=validateRemoteEndpoint(raw,origins)
 validatePublicAddresses(addresses)
 const plan:ConnectionPlan={url,address:addresses[0],servername:url.hostname}
 const first=systemProxy.split(';')[0].trim()
 if(first==='DIRECT')return plan
 const match=/^(PROXY|HTTPS) (\[[0-9a-fA-F:]+\]|[a-zA-Z0-9.-]+):(\d{1,5})$/.exec(first)
 if(!match || Number(match[3])<1 || Number(match[3])>65535)throw Error('系统代理类型不支持或配置无效，不回退直连')
 plan.proxy=new URL((match[1]==='HTTPS'?'https://':'http://')+match[2]+':'+match[3])
 return plan
}
