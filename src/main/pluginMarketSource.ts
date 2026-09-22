import {createHash} from 'node:crypto'
import {validateRemoteEndpoint} from './pluginConnections/endpointPolicy.ts'

/** Catalog URL, not remote display name, is the stable trust/update identity.
 * This validates syntax only. Network callers must still resolve/pin public IPs. */
export function marketSourceIdentity(raw:unknown):{id:string;url:string;origin:string}{
 if(typeof raw!=='string'||raw.length>2048||raw!==raw.trim())throw Error('市场来源地址无效')
 let url:URL
 try {const parsed=new URL(raw);url=validateRemoteEndpoint(raw,[parsed.origin])}
 catch {throw Error('市场来源必须是无凭据的公开 HTTPS 目录地址')}
 return {id:createHash('sha256').update(url.href).digest('hex'),url:url.href,origin:url.origin}
}

/** Never let a higher version in another catalog take over an installed name. */
export function assertOriginalMarketSource(installedSource:string|undefined,requestedSource:string):void{
 if(!installedSource)throw Error('已安装插件来源未知，须先明确确认绑定来源')
 if(installedSource!==requestedSource)throw Error('同名插件来自不同市场，已拒绝跨来源覆盖')
}

import fs from 'node:fs'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
export interface MarketSource {id:string;name:string;url:string;origin:string;generation:string}
/** Fixed host-owned settings path; renderer cannot supply the directory or filename. */
export function createMarketSourceStore(userData:string){
 const file=path.join(userData,'plugin-market-sources.json')
 const list=():MarketSource[]=>{
  try{
   if(fs.lstatSync(file).isSymbolicLink()||fs.statSync(file).size>64*1024)throw Error()
   const rows:unknown=JSON.parse(fs.readFileSync(file,'utf8'))
   if(!Array.isArray(rows)||rows.length>20)throw Error()
   const ids=new Set<string>()
   return rows.map(r=>{
    const identity=marketSourceIdentity(r.url)
    if(identity.id!==r.id||identity.origin!==r.origin||typeof r.name!=='string'||!r.name.trim()||r.name.length>80||typeof r.generation!=='string'||!r.generation||ids.has(r.id))throw Error()
    ids.add(r.id);return {...identity,name:r.name,generation:r.generation}
   })
  }catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return [];throw Error('市场来源配置损坏，请先恢复配置，未覆盖原文件')}
 }
 const save=(rows:MarketSource[])=>{
  fs.mkdirSync(userData,{recursive:true})
  if(fs.existsSync(file)&&fs.lstatSync(file).isSymbolicLink())throw Error('来源配置不能是软链')
  const tmp=file+'.'+randomUUID()+'.tmp'
  try{fs.writeFileSync(tmp,JSON.stringify(rows),{flag:'wx',mode:0o600});fs.renameSync(tmp,file)}finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp)}
 }
 return {list,add(name:unknown,url:unknown){
  if(typeof name!=='string'||!name.trim()||name.length>80)throw Error('来源名称须为1至80字')
  const identity=marketSourceIdentity(url),rows=list()
  if(rows.some(r=>r.id===identity.id))throw Error('该市场来源已经添加')
  if(rows.length>=20)throw Error('最多添加20个外部市场来源')
  const row={...identity,name:name.trim(),generation:randomUUID()};save([...rows,row]);return row
 },remove(id:unknown){const rows=list();if(!rows.some(r=>r.id===id))throw Error('市场来源不存在');save(rows.filter(r=>r.id!==id))},require(id:unknown,generation?:string){
  const row=list().find(r=>r.id===id);if(!row)throw Error('市场来源已移除或不存在')
  if(generation&&row.generation!==generation)throw Error('市场来源已改变，请重新确认')
  return row
 }}
}
