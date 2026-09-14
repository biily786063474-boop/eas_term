import fs from 'node:fs'
import crypto from 'node:crypto'
export interface RuntimeState {mode:'normal'|'eco';stoppedPlugins:string[]}
function parse(raw:unknown):RuntimeState{
 const s=raw as RuntimeState
 if(!s||!['normal','eco'].includes(s.mode)||!Array.isArray(s.stoppedPlugins)||s.stoppedPlugins.length>512||!s.stoppedPlugins.every(k=>typeof k==='string'&&/^[a-z0-9][a-z0-9-]{0,39}$/.test(k)))throw Error('invalid runtime state')
 return {mode:s.mode,stoppedPlugins:[...new Set(s.stoppedPlugins)]}
}
/** The caller supplies a guarded fixed app-owned file, never renderer paths. */
export function createRuntimeStateStore(guardedFile:()=>string){
 return {
  read():RuntimeState{
   const file=guardedFile()
   try{
    if(fs.statSync(file).size>65536)throw Error('oversized')
    return parse(JSON.parse(fs.readFileSync(file,'utf8')))
   }catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return {mode:'normal',stoppedPlugins:[]};throw Error('运行状态文件损坏或不可读；为避免误启动，已阻止自动恢复')}
  },
  write(input:RuntimeState):void{
   const state=parse(input),file=guardedFile(),temp=file+'.tmp-'+crypto.randomUUID()
   let fd:number|undefined
   try{fd=fs.openSync(temp,'wx',0o600);fs.writeFileSync(fd,JSON.stringify(state));fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.renameSync(temp,file)}
   finally{if(fd!==undefined)fs.closeSync(fd);try{fs.unlinkSync(temp)}catch{/* may already be renamed */}}
  }
 }
}
