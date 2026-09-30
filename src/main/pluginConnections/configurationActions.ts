import { tm } from '../../shared/i18n/current.ts'
import type {PluginInfo} from '../../shared/types'
export type ConfigurationResult={ok:true;configured:string[];tools?:number}|{ok:false;error:string}
interface Dependencies {
 acquire:(info:PluginInfo)=>{assertActive:()=>void;dispose:()=>void}
 find:(id:string)=>PluginInfo|undefined
 confirm:(info:PluginInfo,action:'save'|'clear')=>Promise<boolean>
 assertIdle:(name:string)=>void
 load:(info:PluginInfo)=>Record<string,string>|undefined
 save:(info:PluginInfo,values:Record<string,string>)=>void
 clear?:(info:PluginInfo)=>void
 probe?:(info:PluginInfo)=>Promise<number>
 pickDirectory?:(info:PluginInfo,field:string)=>Promise<string|undefined>
}
export const configurationIdentity=(info:PluginInfo)=>JSON.stringify([info.name,info.root,info.config,info.mcp,info.remote,info.permissions])
/** No paths/endpoints or credentials returned to renderer. Omitted fields retain values;
 * null explicitly clears an optional field. Directory grants require a separate native picker. */
export function createConfigurationActions(deps:Dependencies){
 return async(action:unknown,id:unknown,patch?:unknown):Promise<ConfigurationResult>=>{
  let lease:ReturnType<Dependencies["acquire"]>|undefined
  try{
   if(typeof action!=='string'||!['status','save','directory','test','clear'].includes(action)||typeof id!=='string'||!/^eas:[a-z0-9][a-z0-9-]{0,39}$/.test(id))throw Error(tm('errPlugin.conn.e10'))
   const info=deps.find(id)
   if(!info||info.cli!=='eas'||!info.config)throw Error(tm('errPlugin.conn.e11'))
   if(action!=='status')lease=deps.acquire(info)
   if(action==='test'){
    if(info.enabled===false||!deps.probe)throw Error(tm('errPlugin.conn.e12'))
    const snapshot=configurationIdentity(info),tools=await deps.probe(info)
    lease!.assertActive()
    const current=deps.find(id)
    if(!current||current.enabled===false||configurationIdentity(current)!==snapshot)throw Error(tm('errPlugin.conn.e13'))
    if(!Number.isInteger(tools)||tools<0)throw Error(tm('errPlugin.conn.e14'))
    const values=deps.load(info)??{}
    return {ok:true,configured:info.config.fields.filter(f=>!!values[f.id]).map(f=>f.id),tools}
   }
   if(action==='directory'){
    const field=info.config.fields.find(f=>f.id===patch&&f.type==='directory')
    if(!field||!deps.pickDirectory)throw Error(tm('errPlugin.conn.e15'))
    const snapshot=configurationIdentity(info)
    const grant=await deps.pickDirectory(info,field.id)
    if(grant===undefined)return {ok:false,error:tm('errPlugin.conn.e04')}
    lease!.assertActive()
    const current=deps.find(id)
    if(!current||configurationIdentity(current)!==snapshot)throw Error(tm('errPlugin.conn.e05'))
    deps.assertIdle(info.name)
    const values={...deps.load(info),[field.id]:grant}
    deps.save(info,values)
    return {ok:true,configured:info.config.fields.filter(f=>!!values[f.id]).map(f=>f.id)}
   }
   if(action==='save'||action==='clear'){
    if(action==='save'&&(!patch||typeof patch!=='object'||Array.isArray(patch)||Object.keys(patch).length>32))throw Error(tm('errPlugin.conn.e16'))
    const snapshot=configurationIdentity(info)
    if(!await deps.confirm(info,action))return {ok:false,error:tm('errPlugin.conn.e04')}
    lease!.assertActive()
    const current=deps.find(id)
    if(!current||configurationIdentity(current)!==snapshot)throw Error(tm('errPlugin.conn.e05'))
    if(action==='clear'){if(!deps.clear)throw Error(tm('errPlugin.conn.e17'));deps.clear(info);return {ok:true,configured:[]}}
    deps.assertIdle(info.name)
    const values={...deps.load(info)}
    for(const [key,value] of Object.entries(patch as Record<string,unknown>)){
     const field=info.config.fields.find(f=>f.id===key)
     if(!field)throw Error(tm('errPlugin.conn.e18'))
     if(value===null){delete values[key];continue}
     if(field.type==='directory')throw Error(tm('errPlugin.conn.e19'))
     if(typeof value!=='string'||value.includes('\0'))throw Error(tm('errPlugin.conn.e20'))
     if(field.type==='string'&&value.length>field.maxLength||field.type==='secret'&&value.length>16384)throw Error(tm('errPlugin.conn.e21'))
     if(field.type==='enum'&&!field.options.some(o=>o.value===value))throw Error(tm('errPlugin.conn.e22'))
     values[key]=value
    }
    for(const field of info.config.fields){
     if(field.required&&!values[field.id]?.trim())throw Error(tm('errPlugin.conn.requiredField',{label:field.label}))
    }
    deps.save(info,values)
    return {ok:true,configured:info.config.fields.filter(f=>!!values[f.id]).map(f=>f.id)}
   }
   const values=deps.load(info)??{}
   return {ok:true,configured:info.config.fields.filter(f=>!!values[f.id]).map(f=>f.id)}
  }catch(error){return {ok:false,error:error instanceof Error?error.message:tm('errPlugin.conn.e23')}}finally{lease?.dispose()}
 }
}
