import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {createHash,randomUUID} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import {isDeepStrictEqual} from 'node:util'
import {parseCatalog} from '../src/main/pluginCatalog.ts'
const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
const q=value=>"'"+value.replaceAll("'","'\\''")+"'"
const same=(a,b)=>a&&a.size===b.size&&a.sha256===b.sha256
function readFile(root,rel){
 let current=root
 for(const part of rel.split('/')){
  current=path.join(current,part)
  if(fs.lstatSync(current).isSymbolicLink())throw Error('拒绝符号链接：'+rel)
 }
 if(!fs.statSync(current).isFile())throw Error('不是普通文件：'+rel)
 return fs.readFileSync(current)
}
function releaseFiles(source,baseUrl){
 const base=new URL(baseUrl)
 if(base.protocol!=='https:'||base.username||base.password||base.search||base.hash)throw Error('URL 基址无效')
 const prefix=base.href.replace(/\/$/,'')
 const catalogs=['registry-v2.json','registry.json'].map(rel=>{
  const bytes=readFile(source,rel),raw=JSON.parse(bytes)
  const parsed=parseCatalog(raw,{allowedHosts:[base.hostname]})
  if(raw.schema!==(rel==='registry.json'?1:2)||!parsed.ok||parsed.warnings.length)throw Error('目录校验失败：'+rel)
  return {rel,bytes,raw,entries:parsed.entries}
 })
 const [v2,v1]=catalogs
 if(v1.raw.plugins.some(e=>e.requirements!==undefined))throw Error('旧目录 legacy 不得包含宿主能力要求')
 if(!isDeepStrictEqual(v1.entries,v2.entries.filter(e=>e.requirements===undefined)))throw Error('两个目录的旧客户端条目不一致')
 const packages=v2.entries.map(entry=>{
  const rel=`${entry.name}/${entry.name}-${entry.version}.zip`
  if(entry.url!==prefix+'/'+rel)throw Error('下载 URL 必须是规范版本路径：'+rel)
  const bytes=readFile(source,rel)
  if(bytes.length!==entry.size||hash(bytes)!==entry.sha256)throw Error('本地包 integrity 校验失败：'+rel)
  return {rel,bytes}
 })
 return {packages,catalogs:catalogs.map(({rel,bytes})=>({rel,bytes}))}
}
/** Validate and snapshot every byte before touching transport. Catalogs are
 * individually atomic, NOT a cross-file transaction. A late failure can leave
 * v2 new / v1 old, both referencing complete immutable packages. */
export async function publishPluginRegistries({source,baseUrl='https://eas.biily.top/plugins',transport}){
 const files=releaseFiles(path.resolve(source),baseUrl)
 const snapshot=fs.mkdtempSync(path.join(os.tmpdir(),'eas-plugin-release-'))
 const id=randomUUID();let locked=false
 try{
  for(const file of [...files.packages,...files.catalogs]){
   file.size=file.bytes.length;file.sha256=hash(file.bytes)
   file.local=path.join(snapshot,file.rel);fs.mkdirSync(path.dirname(file.local),{recursive:true});fs.writeFileSync(file.local,file.bytes)
  }
  transport.acquire(id);locked=true
  const missing=[]
  for(const file of files.packages){
   const current=transport.inspect(file.rel)
   if(current&&!same(current,file))throw Error('immutable 同版本包内容冲突，请升级版本：'+file.rel)
   if(!current)missing.push(file)
  }
  transport.stage(id)
  // Verify ALL uploads before promoting ANY live catalog or package.
  for(const file of [...missing,...files.catalogs]){
   file.staged=`.release-${id}/${path.basename(file.rel)}`
   transport.upload(file.local,file.staged)
   if(!same(transport.inspect(file.staged),file))throw Error('上传 integrity 校验失败：'+file.rel)
  }
  for(const file of missing)transport.promotePackage(file.staged,file.rel)
  for(const file of files.catalogs)transport.promoteCatalog(file.staged,file.rel,id)
  return {release:id,packages:files.packages.length,uploadedPackages:missing.length,catalogs:files.catalogs.map(f=>f.rel)}
 }finally{
  try{if(locked)transport.release(id)}finally{fs.rmSync(snapshot,{recursive:true,force:true})}
 }
}
/** No recursive SCP, service reload, stale-lock stealing, archive overwrite or
 * automatic retry on uncertain SSH outcomes. Retain .release-<id> (previous
 * catalogs / failed staging) for manual recovery. */
export class SshPluginPublisher {
 constructor({host='server',root='/www/wwwroot/eas/plugins',run=(cmd,args)=>execFileSync(cmd,args,{encoding:'utf8',timeout:120000,stdio:['ignore','pipe','pipe']})}={}){
  if(!/^[a-zA-Z0-9][a-zA-Z0-9_.@-]*$/.test(host)||!/^\/[a-zA-Z0-9_./-]+$/.test(root)||root.split('/').includes('..')||root==='/')throw Error('发布目标无效')
  this.host=host;this.root=root.replace(/\/$/,'');this.run=run
 }
 remote(rel){
  if(!/^[a-zA-Z0-9_.+/-]+$/.test(rel)||rel.startsWith('/')||rel.split('/').some(p=>p==='..'||p==='.'||!p))throw Error('远端相对路径无效')
  return this.root+'/'+rel
 }
 ssh(script){return this.run('ssh',['-n','-o','BatchMode=yes','-o','ConnectTimeout=15',this.host,'set -eu; '+script])}
 acquire(id){
  this.ssh(`test ! -L ${q(this.root)}; test -d ${q(this.root)}; mkdir ${q(this.remote('.publish-lock'))}; printf '%s' ${q(id)} > ${q(this.remote('.publish-lock/owner'))}`)
 }
 release(id){
  this.ssh(`test "$(cat ${q(this.remote('.publish-lock/owner'))})" = ${q(id)}; rm ${q(this.remote('.publish-lock/owner'))}; rmdir ${q(this.remote('.publish-lock'))}`)
 }
 inspect(rel){
  const file=q(this.remote(rel)),parent=q(path.posix.dirname(this.remote(rel)))
  const output=String(this.ssh(`test ! -L ${parent}; test ! -L ${file}; if test -e ${file}; then test -f ${file}; wc -c < ${file}; sha256sum ${file}; else printf 'missing'; fi`)).trim()
  if(output==='missing')return null
  const match=/^(\d+)\s+([a-f0-9]{64})\s/.exec(output)
  if(!match)throw Error('远端文件校验输出无效：'+rel)
  return {size:Number(match[1]),sha256:match[2]}
 }
 stage(id){this.ssh(`mkdir -m 700 ${q(this.remote('.release-'+id))}`)}
 upload(local,rel){this.run('scp',['-q','-o','BatchMode=yes','-o','ConnectTimeout=15',local,this.host+':'+this.remote(rel)])}
 promotePackage(staged,rel){
  const parent=q(path.posix.dirname(this.remote(rel))),from=q(this.remote(staged)),to=q(this.remote(rel))
  // Hardlink create fails if final exists; unlike mv, never overwrites a version.
  this.ssh(`test ! -L ${parent}; mkdir -p -m 755 ${parent}; chmod 644 ${from}; ln ${from} ${to}; rm ${from}`)
 }
 promoteCatalog(staged,rel,id){
  if(!['registry.json','registry-v2.json'].includes(rel))throw Error('目录名无效')
  const to=q(this.remote(rel)),from=q(this.remote(staged)),backup=q(this.remote(`.release-${id}/previous-${rel}`))
  this.ssh(`test ! -L ${to}; if test -e ${to}; then test -f ${to}; cp ${to} ${backup}; fi; chmod 644 ${from}; mv -f ${from} ${to}`)
 }
}
