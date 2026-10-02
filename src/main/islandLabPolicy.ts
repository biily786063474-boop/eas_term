import fs from 'node:fs'
import path from 'node:path'
export const ISLAND_LAB_NAME='Eas-Term Island Lab'
export function isIslandLab(name:string):boolean{return name===ISLAND_LAB_NAME}
export function islandLabProfile(appData:string):string{return path.join(appData,ISLAND_LAB_NAME)}
export function labEnvironment(env:NodeJS.ProcessEnv,home:string):NodeJS.ProcessEnv {
 const next={...env}
 delete next.ENV;delete next.BASH_ENV
 for(const key of Object.keys(next))if(/TOKEN|SECRET|API_KEY|PASSWORD|AUTHORIZATION/.test(key)||key.startsWith('EAS_TERM_')||key.startsWith('EAS_CAPABILITY_'))delete next[key]
 Object.assign(next,{ZDOTDIR:home,XDG_STATE_HOME:path.join(home,'.local/state'),CODEX_HOME:path.join(home,'.codex'),DSH_HOME:path.join(home,'.dsh'),CLAUDE_CONFIG_DIR:path.join(home,'.claude'),PI_CONFIG_DIR:'.omp',XDG_CONFIG_HOME:path.join(home,'.config'),XDG_CACHE_HOME:path.join(home,'.cache'),XDG_DATA_HOME:path.join(home,'.local/share')})
 return next
}

// Only fixed application-owned paths: never consume inherited environment paths here.
export function initializeLabHome(home:string):void {
 for(const relative of ['','.codex','.claude','.dsh','.omp','.config','.cache','.local/state','.local/share']){
  fs.mkdirSync(path.join(home,relative),{recursive:true,mode:0o700})
 }
}
