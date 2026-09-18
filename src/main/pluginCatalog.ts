import {parseRegistry,type RegistryEntry} from './pluginRegistry.ts'
import type {PluginUnavailableEntry} from '../shared/types'
type Result={ok:true;entries:RegistryEntry[];unavailable:PluginUnavailableEntry[];warnings:string[]}|{ok:false;errors:string[]}
/** New catalog reader. Legacy parseRegistry deliberately still rejects schema 2. */
export function parseCatalog(raw:unknown,options:{allowedHosts:readonly string[]}):Result {
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return {ok:false,errors:['目录不是对象']}
 const data=raw as Record<string,unknown>
 if(data.schema!==1&&data.schema!==2)return {ok:false,errors:['目录schema不支持']}
 const registry=parseRegistry({...data,schema:1},options)
 if(!registry.ok)return registry
 if(data.schema===1)return {...registry,unavailable:[]}
 if(!Array.isArray(data.unavailable)||data.unavailable.length>500)return {ok:false,errors:['不可安装条目列表无效']}
 const seen=new Set(registry.entries.map(e=>e.name)),unavailable:PluginUnavailableEntry[]=[]
 for(const item of data.unavailable){
  if(!item||typeof item!=='object'||Array.isArray(item))return {ok:false,errors:['不可安装条目无效']}
  const e=item as Record<string,unknown>
  if(Object.keys(e).some(k=>!['name','displayName','description','category','brandColor','reason','source'].includes(k)))return {ok:false,errors:['不可安装条目不得包含下载包或未知字段']}
  if(typeof e.name!=='string'||!/^[a-z0-9][a-z0-9-]{0,39}$/.test(e.name)||seen.has(e.name)||typeof e.displayName!=='string'||!e.displayName.trim()||typeof e.reason!=='string'||!e.reason.trim())return {ok:false,errors:['不可安装条目身份/原因无效或重名']}
  for(const value of Object.values(e))if(typeof value!=='string'||value.length>4096)return {ok:false,errors:['不可安装条目字段无效']}
  if(e.source){try{const source=new URL(String(e.source));if(source.protocol!=='https:'||source.username||source.password)throw Error()}catch{return {ok:false,errors:['来源链接无效']}}}
  seen.add(e.name)
  unavailable.push({name:e.name,displayName:e.displayName,reason:e.reason,description:e.description as string|undefined,category:e.category as string|undefined,brandColor:e.brandColor as string|undefined,source:e.source as string|undefined})
 }
 return {...registry,unavailable}
}
