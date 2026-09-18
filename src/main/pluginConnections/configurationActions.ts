import type {PluginInfo} from '../../shared/types'
export type ConfigurationResult={ok:true;configured:string[]}|{ok:false;error:string}
interface Dependencies {
 acquire:()=>{assertActive:()=>void;dispose:()=>void}
 find:(id:string)=>PluginInfo|undefined
 confirm:(info:PluginInfo)=>Promise<boolean>
 assertIdle:(name:string)=>void
 load:(info:PluginInfo)=>Record<string,string>|undefined
 save:(info:PluginInfo,values:Record<string,string>)=>void
 pickDirectory?:(info:PluginInfo,field:string)=>Promise<string|undefined>
}
export const configurationIdentity=(info:PluginInfo)=>JSON.stringify([info.name,info.root,info.config,info.mcp,info.remote,info.permissions])
/** No paths/endpoints or credentials returned to renderer. Omitted fields retain values;
 * null explicitly clears an optional field. Directory grants require a separate native picker. */
export function createConfigurationActions(deps:Dependencies){
 return async(action:unknown,id:unknown,patch?:unknown):Promise<ConfigurationResult>=>{
  let lease:ReturnType<Dependencies["acquire"]>|undefined
  try{
   if(typeof action!=='string'||!['status','save','directory'].includes(action)||typeof id!=='string'||!/^eas:[a-z0-9][a-z0-9-]{0,39}$/.test(id))throw Error('配置参数无效')
   const info=deps.find(id)
   if(!info||info.cli!=='eas'||!info.config)throw Error('插件没有配置声明')
   if(action!=='status')lease=deps.acquire()
   if(action==='directory'){
    const field=info.config.fields.find(f=>f.id===patch&&f.type==='directory')
    if(!field||!deps.pickDirectory)throw Error('目录选择参数无效')
    const snapshot=configurationIdentity(info)
    const grant=await deps.pickDirectory(info,field.id)
    if(grant===undefined)return {ok:false,error:'已取消'}
    lease!.assertActive()
    const current=deps.find(id)
    if(!current||configurationIdentity(current)!==snapshot)throw Error('插件配置已变化，请重新确认')
    deps.assertIdle(info.name)
    const values={...deps.load(info),[field.id]:grant}
    deps.save(info,values)
    return {ok:true,configured:info.config.fields.filter(f=>!!values[f.id]).map(f=>f.id)}
   }
   if(action==='save'){
    if(!patch||typeof patch!=='object'||Array.isArray(patch)||Object.keys(patch).length>32)throw Error('配置输入无效')
    const snapshot=configurationIdentity(info)
    if(!await deps.confirm(info))return {ok:false,error:'已取消'}
    lease!.assertActive()
    const current=deps.find(id)
    if(!current||configurationIdentity(current)!==snapshot)throw Error('插件配置已变化，请重新确认')
    deps.assertIdle(info.name)
    const values={...deps.load(info)}
    for(const [key,value] of Object.entries(patch)){
     const field=info.config.fields.find(f=>f.id===key)
     if(!field)throw Error('存在未知配置字段')
     if(value===null){delete values[key];continue}
     if(field.type==='directory')throw Error('目录必须通过原生选择器授权')
     if(typeof value!=='string'||value.includes('\0'))throw Error('配置值格式无效')
     if(field.type==='string'&&value.length>field.maxLength||field.type==='secret'&&value.length>16384)throw Error('配置值长度超限')
     if(field.type==='enum'&&!field.options.some(o=>o.value===value))throw Error('枚举选项无效')
     values[key]=value
    }
    for(const field of info.config.fields){
     if(field.required&&!values[field.id]?.trim())throw Error('缺少必填配置：'+field.label)
    }
    deps.save(info,values)
    return {ok:true,configured:info.config.fields.filter(f=>!!values[f.id]).map(f=>f.id)}
   }
   const values=deps.load(info)??{}
   return {ok:true,configured:info.config.fields.filter(f=>!!values[f.id]).map(f=>f.id)}
  }catch(error){return {ok:false,error:error instanceof Error?error.message:'插件配置操作失败'}}finally{lease?.dispose()}
 }
}
