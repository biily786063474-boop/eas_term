import fs from 'node:fs'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {packPlugin} from './pack-plugin.mjs'
import {parseCatalog} from '../src/main/pluginCatalog.ts'
import {parseManifest} from '../src/main/pluginManifest.ts'
const digest=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex')
/** Local build only. Never invokes upload, network, dependency installation or host build. */
export function buildPluginRegistries({plugins,outRoot='dist/plugins',baseUrl='https://eas.biily.top/plugins',unavailable=[]}){
 const base=new URL(baseUrl)
 if(base.protocol!=='https:'||base.username||base.password||base.search||base.hash)throw Error('目录下载基址必须是公开HTTPS地址')
 const output=path.resolve(outRoot)
 fs.mkdirSync(output,{recursive:true})
 const v2Dir=path.join(output,'v2')
 const v2Stat=fs.lstatSync(v2Dir,{throwIfNoEntry:false})
 if(v2Stat?.isSymbolicLink())throw Error('拒绝目录符号链接：v2')
 if(v2Stat&&!v2Stat.isDirectory())throw Error('v2 必须是目录')
 const stage=fs.mkdtempSync(path.join(output,'.build-'))
 try{
  const seen=new Set(),packages=[]
  for(const dir of plugins){
   const manifest=JSON.parse(fs.readFileSync(path.join(dir,'plugin.json'),'utf8'))
   if(seen.has(manifest.name))throw Error('插件名称重复：'+manifest.name)
   seen.add(manifest.name)
   const checked=parseManifest(manifest,path.resolve(dir))
   if(!checked.ok)throw Error('插件清单无效：'+checked.errors.join(';'))
   packages.push(packPlugin(dir,{outRoot:stage,baseUrl,registrySchema:2}))
  }
  const updated=new Date().toISOString()
  const entries=packages.map(p=>p.entry)
  const v1={schema:1,updated,plugins:entries.filter(entry=>entry.requirements===undefined)}
  const v2={schema:2,updated,plugins:entries,unavailable}
  for(const catalog of [v1,v2]){
   const result=parseCatalog(catalog,{allowedHosts:[base.hostname]})
   if(!result.ok||result.warnings.length)throw Error('目录校验失败：'+(result.ok?result.warnings:result.errors).join(';'))
  }
  // Preflight all immutable paths before any promotion. Version bump is mandatory on change.
  for(const {entry} of packages){
   const file=path.join(output,entry.name,`${entry.name}-${entry.version}.zip`)
   if(fs.existsSync(file)&&digest(file)!==entry.sha256)throw Error('同版本包内容已改变，请升级版本：'+entry.name+'@'+entry.version)
  }
  for(const {entry,zipPath} of packages){
   const file=path.join(output,entry.name,path.basename(zipPath))
   fs.mkdirSync(path.dirname(file),{recursive:true})
   if(!fs.existsSync(file))fs.copyFileSync(zipPath,file,fs.constants.COPYFILE_EXCL)
  }
  // Individually atomic catalogs; deliberately NOT a cross-file transaction.
  for(const [name,data] of [['v2/registry.json',v2],['registry.json',v1]]){
   const file=path.join(stage,name)
   fs.mkdirSync(path.dirname(file),{recursive:true})
   fs.mkdirSync(path.dirname(path.join(output,name)),{recursive:true})
   fs.writeFileSync(file,JSON.stringify(data,null,2)+'\n')
   fs.renameSync(file,path.join(output,name))
  }
  return {v1,v2}
 }finally{fs.rmSync(stage,{recursive:true,force:true})}
}
