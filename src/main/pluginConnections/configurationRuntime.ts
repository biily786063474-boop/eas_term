import { tm } from '../../shared/i18n/current.ts'
import type {PluginInfo} from '../../shared/types'
import {resolveDirectoryGrant} from './directoryGrant.ts'
/** Values stay inside main and the explicitly selected stdio plugin, never the CLI shim. */
export function configurationEnvironment(info:PluginInfo,values:Record<string,string>|undefined):string{
 if(!info.config||!info.mcp||info.remote)throw Error(tm('errPlugin.conn.e38'))
 const output:Record<string,unknown>={}
 for(const field of info.config.fields){
  const value=values?.[field.id]
  if(value===undefined||value===''){
   if(field.required)throw Error(tm('errPlugin.conn.configFirst',{label:field.label}))
   continue
  }
  if(typeof value!=='string'||value.includes('\0'))throw Error(tm('errPlugin.conn.e39'))
  if(field.type==='directory')output[field.id]=resolveDirectoryGrant(value,field.access)
  else{
   if(field.type==='enum'&&!field.options.some(o=>o.value===value)||field.type==='string'&&value.length>field.maxLength||field.type==='secret'&&value.length>16384)throw Error(tm('errPlugin.conn.e40'))
   output[field.id]=value
  }
 }
 return JSON.stringify(output)
}
