import type {FetchLike} from '@modelcontextprotocol/sdk/shared/transport.js'
import {connectBearerConfiguration} from './pluginConnections/bearerConfiguration.ts'
import { configurationEnvironment } from './pluginConnections/configurationRuntime.ts'
import {app} from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import {createHash} from 'node:crypto'
import type {PluginInfo} from '../shared/types'
import {acquirePluginCredentialAccess} from './secrets'
import {PluginCredentialStore} from './pluginConnections/credentialStore.ts'
import {configurationIdentity} from './pluginConnections/configurationActions.ts'
/** Fixed main-owned storage; no IPC caller path or credential namespace selection. */
function access<T>(info:PluginInfo,op:(store:PluginCredentialStore,scope:{plugin:string;issuer:string;resource:string;account:string},lease:ReturnType<typeof acquirePluginCredentialAccess>)=>T):T{
 if(!app.isReady()||info.cli!=='eas'||!info.config)throw Error('插件配置不可用')
 const scope={plugin:info.name,issuer:'eas:configuration:v1',resource:createHash('sha256').update(configurationIdentity(info)).digest('hex'),account:'local-primary'}
 const store=new PluginCredentialStore(path.join(fs.realpathSync(app.getPath('userData')),'plugin-credentials'))
 const lease=acquirePluginCredentialAccess()
 try{return op(store,scope,lease)}finally{lease.dispose()}
}
export const loadPluginConfiguration=(info:PluginInfo)=>access(info,(store,scope,lease)=>store.loadConfiguration(scope,lease))
export const savePluginConfiguration=(info:PluginInfo,values:Record<string,string>)=>access(info,(store,scope,lease)=>store.saveConfiguration(scope,values,lease))

/** Long-lived lease: locking the vault closes precisely the configured child. */
export function connectPluginConfiguration(info:PluginInfo){
 if(!app.isReady()||info.cli!=='eas'||!info.config)throw Error('插件配置不可用')
 const lease=acquirePluginCredentialAccess()
 try{
  const scope={plugin:info.name,issuer:'eas:configuration:v1',resource:createHash('sha256').update(configurationIdentity(info)).digest('hex'),account:'local-primary'}
  const store=new PluginCredentialStore(path.join(fs.realpathSync(app.getPath('userData')),'plugin-credentials'))
  const environment=configurationEnvironment(info,store.loadConfiguration(scope,lease))
  lease.assertActive()
  return {environment,signal:lease.signal,close:lease.dispose}
 }catch(error){lease.dispose();throw error}
}

/** Holds the original vault lease for the entire remote connection. */
export function connectPluginBearer(info:PluginInfo,fetch:FetchLike){
 if(!app.isReady()||info.cli!=='eas'||info.remote?.auth!=='bearer')throw Error('Bearer配置不可用')
 const lease=acquirePluginCredentialAccess()
 try{
  const scope={plugin:info.name,issuer:'eas:configuration:v1',resource:createHash('sha256').update(configurationIdentity(info)).digest('hex'),account:'local-primary'}
  const store=new PluginCredentialStore(path.join(fs.realpathSync(app.getPath('userData')),'plugin-credentials'))
  return connectBearerConfiguration({info,lease,fetch,load:()=>store.loadConfiguration(scope,lease)})
 }catch(error){lease.dispose();throw error}
}
