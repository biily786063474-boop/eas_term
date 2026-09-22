import fs from 'node:fs'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
import {parseManifest} from './pluginManifest.ts'

/** Host-only fixed paths, never renderer-provided. Do not follow symlink ancestors. */
function noLinks(p:string):void {
 const parent=path.dirname(p)
 if(parent!==p)noLinks(parent)
 try{if(fs.lstatSync(p).isSymbolicLink())throw Error('迁移路径不能是软链')}
 catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e}
}
function exists(p:string):boolean{try{fs.lstatSync(p);return true}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return false;throw e}}
function checkTree(p:string):void{
 const s=fs.lstatSync(p)
 if(s.isSymbolicLink())throw Error('迁移包不能包含软链')
 if(s.isDirectory()){for(const n of fs.readdirSync(p))checkTree(path.join(p,n))}
 else if(!s.isFile())throw Error('迁移包包含特殊文件')
}
/** One-time offline seed, never an updater. Marker is outside uninstallable plugin root.
 * Existing copies (even unknown/broken/newer ones) remain entirely user-owned.
 * A crash after atomic promotion retries as "preserved"; no partial tree is scanned. */
export function migrateTimeline(home:string,seed:string):'done'|'preserved'|'installed'{
 home=fs.realpathSync(home)
 const eas=path.join(home,'.eas'),plugins=path.join(eas,'plugins'),dest=path.join(plugins,'timeline')
 const marker=path.join(eas,'timeline-independent-v1.json')
 noLinks(marker);noLinks(dest)
 if(exists(marker)){
  const value=JSON.parse(fs.readFileSync(marker,'utf8'))
  if(value.schema!==1||value.complete!==true)throw Error('时间线迁移记录损坏')
  return 'done'
 }
 fs.mkdirSync(plugins,{recursive:true})
 const lock=path.join(eas,'timeline-independent-v1.lock')
 // No automatic stale lock stealing: another process may still own the migration.
 fs.mkdirSync(lock)
 const stage=path.join(lock,randomUUID()),staged=path.join(stage,'timeline')
 try{
  const preserved=exists(dest)
  if(!preserved){
   seed=path.join(fs.realpathSync(path.dirname(seed)),path.basename(seed))
   noLinks(seed);checkTree(seed)
   const raw=JSON.parse(fs.readFileSync(path.join(seed,'plugin.json'),'utf8'))
   const parsed=parseManifest(raw,seed,{exists:fs.existsSync})
   if(!parsed.ok||raw.name!=='timeline'||!/^\d+\.\d+\.\d+$/.test(raw.version??''))throw Error('时间线迁移包无效')
   if(exists(path.join(seed,'.eas-market-source.json')))throw Error('迁移包不能自带来源收据')
   fs.cpSync(seed,staged,{recursive:true,errorOnExist:true,force:false})
   fs.writeFileSync(path.join(staged,'.eas-market-source.json'),JSON.stringify({id:'official'}),{flag:'wx',mode:0o600})
   noLinks(dest)
   if(exists(dest))throw Error('迁移期间出现用户插件，未覆盖')
   fs.renameSync(staged,dest)
  }
  fs.writeFileSync(path.join(lock,'complete.json'),JSON.stringify({schema:1,complete:true}),{flag:'wx',mode:0o600})
  fs.renameSync(path.join(lock,'complete.json'),marker)
  return preserved?'preserved':'installed'
 }finally{fs.rmSync(lock,{recursive:true,force:true})}
}
