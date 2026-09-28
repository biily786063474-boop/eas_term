import fs from 'node:fs'
import path from 'node:path'
const keys=['milestone','project','triage','docs','eval','route','custom']
export function preferenceStore(directory){
 if(typeof directory!=='string'||!path.isAbsolute(directory))throw Error('Missing host data directory')
 const root=fs.realpathSync(directory),file=path.join(root,'preferences.json')
 function selections(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||keys.some(k=>typeof value[k]!=='boolean'))throw Error('Invalid preferences')
  return Object.fromEntries(keys.map(k=>[k,value[k]]))
 }
 function validate(value){
  if(value?.version===2){
   if(Object.keys(value).some(k=>!['version','enabledIntent','selected','projectIds','automationScopes'].includes(k))||typeof value.enabledIntent!=='boolean')throw Error('Invalid preferences')
   if(value.projectIds!==undefined&&(!Array.isArray(value.projectIds)||value.projectIds.length>64||value.projectIds.some(id=>typeof id!=='string'||!id||id.length>200)))throw Error('Invalid preferences')
   if(value.automationScopes!==undefined&&(!value.automationScopes||Object.keys(value.automationScopes).some(k=>!['milestone','project'].includes(k))||['milestone','project'].some(k=>!Array.isArray(value.automationScopes[k])||value.automationScopes[k].length>32||value.automationScopes[k].some(id=>typeof id!=='string'||!id||id.length>200))))throw Error('Invalid preferences')
   return {...(value.automationScopes?{automationScopes:structuredClone(value.automationScopes)}:{}),version:2,enabledIntent:value.enabledIntent,selected:selections(value.selected),...(value.projectIds?{projectIds:[...new Set(value.projectIds)]}:{})}
  }
  return {version:2,enabledIntent:false,selected:selections(value)}
 }
 return {
  load(){try{const stat=fs.lstatSync(file);if(!stat.isFile()||stat.size>32768)throw Error('Invalid preferences');return validate(JSON.parse(fs.readFileSync(file,'utf8')))}catch(error){if(error.code==='ENOENT')return undefined;throw Error('Jev 设置损坏，请恢复设置后重试')}},
  save(value){const clean=validate(value),temporary=path.join(root,'.preferences-'+process.pid+'-'+Date.now());try{fs.writeFileSync(temporary,JSON.stringify(clean),{flag:'wx',mode:0o600});fs.renameSync(temporary,file)}finally{try{fs.unlinkSync(temporary)}catch{}}}
 }
}
