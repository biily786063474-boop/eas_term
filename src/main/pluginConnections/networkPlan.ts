import { tm } from '../../shared/i18n/current.ts'
import {validateRemoteEndpoint,validatePublicAddresses} from './endpointPolicy.ts'
export interface ConnectionPlan {url:URL; address:string; servername:string; proxy?:URL}
/** Proxy decisions come from the trusted OS session, never a plugin or renderer field. */
export function planConnection(raw:string,origins:readonly string[],addresses:readonly string[],systemProxy:string):ConnectionPlan {
 const url=validateRemoteEndpoint(raw,origins)
 const first=systemProxy.split(';')[0].trim()
 if(first==='DIRECT'){
  // 直连：钉住本地解析出的地址去连，所以必须先确认它是公网地址
  validatePublicAddresses(addresses)
  return {url,address:addresses[0],servername:url.hostname}
 }
 // 走代理（2026-09-30 用户拍板）：address 用域名，HttpsProxyAgent 会 CONNECT 域名:端口，由代理解析和连接；
 // 本地 DNS 结果完全不参与连接，不再拿它做内网判断（Clash 系统代理 + fake-ip 时本地解析是 198.18.x.x，原先会被误拦）。
 // TLS 仍按 servername 校验证书。
 const plan:ConnectionPlan={url,address:url.hostname,servername:url.hostname}
 const match=/^(PROXY|HTTPS) (\[[0-9a-fA-F:]+\]|[a-zA-Z0-9.-]+):(\d{1,5})$/.exec(first)
 if(!match || Number(match[3])<1 || Number(match[3])>65535)throw Error(tm('errPlugin.conn.e91'))
 plan.proxy=new URL((match[1]==='HTTPS'?'https://':'http://')+match[2]+':'+match[3])
 return plan
}
