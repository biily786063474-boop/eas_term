// Host-owned grants. Never callable from AI tools; only authenticated panel RPC.
import {app} from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
import {guardDir} from './fsGuard.ts'
import {projectRootOf} from '../shared/roleWorktree.ts'
import {PluginEventBus,setPluginTurnReceiver,type PluginTurnEvent} from './pluginEvents.ts'
// @ts-expect-error shared standalone plugin protocol
import {withEventGrantLock} from '../../resources/plugins/timeline/lib/eventAuthorization.mjs'
interface Grant { enabled: boolean; excluded: string[]; epoch?: string }
export const eventGrantFile=()=>file()
export const eventGrantEpoch=(name:string)=>grants.get(name)?.epoch
interface Project {id:string;name:string;cwd:string}
const grants = new Map<string,Grant>(), errors = new Map<string,string>()
const bus = new PluginEventBus(64,(id,message)=>errors.set(id,message))
let send: (name:string,event:PluginTurnEvent,project:Project,signal:AbortSignal)=>Promise<void>
let allowed: (name:string)=>boolean
const file=()=>path.join(app.getPath('userData'),'plugin-event-grants.json')
function save(){
 const target=file(),tmp=target+'.'+randomUUID()+'.tmp'
 if(fs.existsSync(target)&&fs.lstatSync(target).isSymbolicLink())throw Error('授权文件不能为软链')
 const fd=fs.openSync(tmp,'wx',0o600)
 try{fs.writeFileSync(fd,JSON.stringify(Object.fromEntries(grants)));fs.fsyncSync(fd)}finally{fs.closeSync(fd)}
 try{fs.renameSync(tmp,target)}finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp)}
}
export function eventProjects(name:string):Project[]{
 const grant=grants.get(name);if(!grant)return []
 const raw=JSON.parse(fs.readFileSync(path.join(app.getPath('userData'),'projects.json'),'utf8'))
 if(!Array.isArray(raw))throw Error('项目登记表损坏')
 return raw.filter(p=>typeof p.id==='string'&&!grant.excluded.includes(p.id)).map(p=>{const root=guardDir(projectRootOf(p.path));if(!root.ok)return null;return {id:p.id,name:String(p.name||p.id),cwd:root.path}}).filter((p):p is Project=>!!p)
}
function arm(name:string){bus.disable(name);const g=grants.get(name);if(!g?.enabled||!allowed(name))return;const projects=eventProjects(name);bus.enable(name,projects.map(p=>p.id),async(e,signal)=>{const fresh=eventProjects(name).find(p=>p.id===e.projectId);if(signal.aborted||!grants.get(name)?.enabled||!allowed(name)||!fresh)return;await send(name,e,fresh,signal)})}
function updateReceiver(){setPluginTurnReceiver([...grants].some(([n,g])=>g.enabled&&allowed(n))?(cwd,event)=>{
 for(const [name,g] of grants){if(!g.enabled)continue;try{if(!allowed(name)){bus.disable(name);continue}const root=guardDir(projectRootOf(cwd));if(!root.ok)continue;const projects=eventProjects(name),p=projects.find(p=>p.cwd===root.path);if(!p)continue;
 // Refresh registration on newly added project without changing existing sessions.
 const key=projects.map(x=>x.id+':'+x.cwd).join('|');if(scopes.get(name)!==key){arm(name);scopes.set(name,key)}
 bus.publish({...event,projectId:p.id},name)
 }catch(e){errors.set(name,String(e))}}
}:undefined)}
const scopes=new Map<string,string>()
export function initPluginEvents(isAllowed:typeof allowed,deliver:typeof send){allowed=isAllowed;send=deliver;try{const raw=JSON.parse(fs.readFileSync(file(),'utf8'));for(const [name,g] of Object.entries(raw)){const x=g as Grant;if(/^[a-z0-9-]+$/.test(name)&&typeof x.enabled==='boolean'&&Array.isArray(x.excluded)&&x.excluded.every(i=>typeof i==='string'))grants.set(name,x)}}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')errors.set('*','事件授权配置读取失败，自动记录未恢复')};for(const [name,g] of grants)if(!g.epoch){g.epoch=randomUUID();try{withEventGrantLock(file(),save)}catch(e){g.enabled=false;errors.set(name,String(e))}};for(const name of grants.keys())try{arm(name)}catch(e){errors.set(name,String(e))}updateReceiver()}
export function eventPanel(name:string,method:string,params:Record<string,unknown>){
 if(!allowed(name))throw Error('插件未声明完成事件权限')
 if(method!=='panel/state'){
  const excluded=params.excluded??grants.get(name)?.excluded??[]
  if(!Array.isArray(excluded)||excluded.some(x=>typeof x!=='string'))throw Error('排除项目列表无效')
  const previous=grants.get(name);grants.set(name,{enabled:method==='panel/grant',excluded,epoch:randomUUID()})
  try{withEventGrantLock(file(),save)}catch(e){if(previous)grants.set(name,previous);else grants.delete(name);throw e}
  arm(name);scopes.delete(name);updateReceiver()
 }
 const raw=JSON.parse(fs.readFileSync(path.join(app.getPath('userData'),'projects.json'),'utf8'))
 return {protocol:1,enabled:grants.get(name)?.enabled??false,excluded:grants.get(name)?.excluded??[],projects:raw.map((p:{id:string;name:string})=>({id:p.id,name:p.name})),error:errors.get(name)||errors.get('*')||null}
}

/** Revoke the previous runtime generation while retaining the user's saved choice. */
export function invalidatePluginEvents(name:string):void {
 bus.disable(name)
 scopes.delete(name)
}
