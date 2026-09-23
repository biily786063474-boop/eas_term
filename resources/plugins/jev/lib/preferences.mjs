import fs from 'node:fs'
import path from 'node:path'
const keys=['milestone','project','triage','docs','eval','route','custom']
export function preferenceStore(directory){
 if(typeof directory!=='string'||!path.isAbsolute(directory))throw Error('Missing host data directory')
 const root=fs.realpathSync(directory),file=path.join(root,'preferences.json')
 function validate(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||keys.some(k=>typeof value[k]!=='boolean'))throw Error('Invalid preferences')
  return Object.fromEntries(keys.map(k=>[k,value[k]]))
 }
 return {
  load(){try{const stat=fs.lstatSync(file);if(!stat.isFile()||stat.size>4096)throw Error('Invalid preferences');return validate(JSON.parse(fs.readFileSync(file,'utf8')))}catch(error){if(error.code==='ENOENT')return undefined;throw Error('Jev 设置损坏，请恢复设置后重试')}},
  save(value){const clean=validate(value),temporary=path.join(root,'.preferences-'+process.pid+'-'+Date.now());try{fs.writeFileSync(temporary,JSON.stringify(clean),{flag:'wx',mode:0o600});fs.renameSync(temporary,file)}finally{try{fs.unlinkSync(temporary)}catch{}}}
 }
}
