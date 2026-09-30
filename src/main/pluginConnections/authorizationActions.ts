import { tm } from '../../shared/i18n/current.ts'
import type {PluginInfo} from '../../shared/types'
import type {PluginAuthorizationResult} from '../../shared/pluginAuthorization.ts'
import type {PluginAuthorizationRuntime} from './authorizationRuntime.ts'
interface Dependencies {
 find:(id:string)=>PluginInfo|undefined
 runtime:(info:PluginInfo)=>Pick<PluginAuthorizationRuntime,'status'|'login'|'disconnect'>
 probe?:(info:PluginInfo)=>Promise<number>
 confirm:(info:PluginInfo,action:'login'|'disconnect')=>Promise<boolean>
}
/** IPC accepts only action + installed ID. Never accepts endpoint, token, path or client ID. */
export function createAuthorizationActions(deps:Dependencies){
 return async(action:unknown,id:unknown):Promise<PluginAuthorizationResult>=>{
  try{
   if(typeof action!=='string'||!['status','login','disconnect','test'].includes(action)||typeof id!=='string'||!/^eas:[a-z0-9][a-z0-9-]{0,39}$/.test(id))throw Error(tm('errPlugin.conn.e01'))
   const info=deps.find(id)
   if(!info||info.cli!=='eas'||info.remote?.auth!=='oauth')throw Error(tm('errPlugin.conn.e02'))
   if((action==='login'||action==='test')&&info.enabled===false)throw Error(tm('errPlugin.conn.e03'))
   const snapshot=JSON.stringify(info.remote)
   if(action==='login'||action==='disconnect'){
    if(!await deps.confirm(info,action as 'login'|'disconnect'))return {ok:false,error:tm('errPlugin.conn.e04')}
    const current=deps.find(id)
    if(!current||JSON.stringify(current.remote)!==snapshot||(action==='login'&&current.enabled===false))throw Error(tm('errPlugin.conn.e05'))
   }
   const runtime=deps.runtime(info)
   if(action==='test'){
    const status=runtime.status()
    if(status!=='authorized'&&status!=='expired')throw Error(tm('errPlugin.conn.e06'))
    if(!deps.probe)throw Error(tm('errPlugin.conn.e07'))
    const toolCount=await deps.probe(info)
    const after=runtime.status(),current=deps.find(id)
    if(after!=='authorized'||!current||current.enabled===false||JSON.stringify(current.remote)!==snapshot)throw Error(tm('errPlugin.conn.e08'))
    return {ok:true,status:after,connection:{toolCount,checkedAt:Date.now()}}
   }
   if(action==='login')await runtime.login()
   if(action==='disconnect')runtime.disconnect()
   return {ok:true,status:runtime.status()}
  }catch(error){return {ok:false,error:error instanceof Error?error.message:tm('errPlugin.conn.e09')}}
 }
}
