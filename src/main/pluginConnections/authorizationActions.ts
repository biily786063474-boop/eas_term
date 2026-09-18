import type {PluginInfo} from '../../shared/types'
import type {PluginAuthorizationResult} from '../../shared/pluginAuthorization.ts'
import type {PluginAuthorizationRuntime} from './authorizationRuntime.ts'
interface Dependencies {
 find:(id:string)=>PluginInfo|undefined
 runtime:(info:PluginInfo)=>Pick<PluginAuthorizationRuntime,'status'|'login'|'disconnect'>
 confirm:(info:PluginInfo,action:'login'|'disconnect')=>Promise<boolean>
}
/** IPC accepts only action + installed ID. Never accepts endpoint, token, path or client ID. */
export function createAuthorizationActions(deps:Dependencies){
 return async(action:unknown,id:unknown):Promise<PluginAuthorizationResult>=>{
  try{
   if(!['status','login','disconnect'].includes(String(action))||typeof id!=='string'||!/^eas:[a-z0-9][a-z0-9-]{0,39}$/.test(id))throw Error('插件授权参数无效')
   const info=deps.find(id)
   if(!info||info.cli!=='eas'||info.remote?.auth!=='oauth')throw Error('插件未配置账号连接')
   if(action==='login'&&info.enabled===false)throw Error('请先启用插件')
   const snapshot=JSON.stringify(info.remote)
   if(action!=='status'){
    if(!await deps.confirm(info,action as 'login'|'disconnect'))return {ok:false,error:'已取消'}
    const current=deps.find(id)
    if(!current||JSON.stringify(current.remote)!==snapshot||(action==='login'&&current.enabled===false))throw Error('插件配置已变化，请重新确认')
   }
   const runtime=deps.runtime(info)
   if(action==='login')await runtime.login()
   if(action==='disconnect')runtime.disconnect()
   return {ok:true,status:runtime.status()}
  }catch(error){return {ok:false,error:error instanceof Error?error.message:'插件账号操作失败'}}
 }
}
