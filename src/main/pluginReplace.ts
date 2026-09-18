import fs from 'node:fs'
import path from 'node:path'
import {randomBytes} from 'node:crypto'
/** Caller must validate package + guardPluginDir first. Prepare on the target volume.
 * Handles ordinary IO failures; not a crash-recovery journal or active-plugin upgrade lock.
 */
export function replacePluginDirectory(stage:string,target:string,io:Pick<typeof fs,'mkdirSync'|'cpSync'|'renameSync'|'rmSync'|'existsSync'|'lstatSync'>=fs){
 const parent=path.dirname(target),suffix=randomBytes(12).toString('hex')
 const incoming=path.join(parent,'.incoming-'+suffix),backup=path.join(parent,'.previous-'+suffix)
 io.mkdirSync(parent,{recursive:true})
 if(io.existsSync(target)&&(!io.lstatSync(target).isDirectory()||io.lstatSync(target).isSymbolicLink()))throw Error('插件目标不是普通目录')
 let movedOld=false,promoted=false
 try{
  io.cpSync(stage,incoming,{recursive:true,errorOnExist:true,force:false})
  if(io.existsSync(target)){io.renameSync(target,backup);movedOld=true}
  try{io.renameSync(incoming,target);promoted=true}
  catch(error){
   if(movedOld){
    try{io.renameSync(backup,target);movedOld=false}
    catch{throw Error('插件更新失败且自动恢复失败；旧版本保留于 '+backup)}
   }
   throw error
  }
 }finally{
  if(io.existsSync(incoming))io.rmSync(incoming,{recursive:true,force:true})
  if(promoted&&movedOld){
   try{io.rmSync(backup,{recursive:true,force:true})}
   catch{console.warn('[plugin] 更新已完成，但旧版本备份清理失败：'+backup)}
  }
 }
}
