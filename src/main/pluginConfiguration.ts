import {supportsJevDecisionsV2} from './pluginConnections/jevProtocol.ts'
import {configurationDigest} from './pluginConnections/jevRecovery.ts'
import {ConfigurationLeases} from './pluginConnections/configurationLeases.ts'
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
const configurationLeases=new ConfigurationLeases()
export const acquireConfigurationAccess=(info:PluginInfo)=>configurationLeases.bind(info.name,acquirePluginCredentialAccess())
/** Fixed main-owned storage; no IPC caller path or credential namespace selection. */
function access<T>(info:PluginInfo,op:(store:PluginCredentialStore,scope:{plugin:string;issuer:string;resource:string;account:string},lease:ReturnType<typeof acquirePluginCredentialAccess>)=>T):T{
 if(!app.isReady()||info.cli!=='eas'||!info.config)throw Error('插件配置不可用')
 const scope={plugin:info.name,issuer:'eas:configuration:v1',resource:createHash('sha256').update(configurationIdentity(info)).digest('hex'),account:'local-primary'}
 const store=new PluginCredentialStore(path.join(fs.realpathSync(app.getPath('userData')),'plugin-credentials'))
 const lease=acquireConfigurationAccess(info)
 try{return op(store,scope,lease)}finally{lease.dispose()}
}
export const loadPluginConfiguration=(info:PluginInfo)=>access(info,(store,scope,lease)=>store.loadConfiguration(scope,lease))
export const savePluginConfiguration=(info:PluginInfo,values:Record<string,string>)=>access(info,(store,scope,lease)=>{
 // Invalidate recovery before changing the key, including replacement with the same key.
 if(info.name==='jev')store.saveConfiguration({...scope,account:'jev-recovery-v1'},{},lease)
 store.saveConfiguration(scope,values,lease)
 if(info.name==='jev')configurationLeases.invalidate(info.name)
})
export const markJevConfigurationVerified=(info:PluginInfo,environment:string)=>supportsJevDecisionsV2(info)?access(info,(store,scope,lease)=>{
 if(info.name!=='jev')return
 const current=configurationEnvironment(info,store.loadConfiguration(scope,lease))
 if(current!==environment)throw Error('插件配置已变化')
 store.saveConfiguration({...scope,account:'jev-recovery-v1'},{digest:configurationDigest(environment)},lease)
}):undefined
export const canRestoreJevConfiguration=(info:PluginInfo,environment:string)=>supportsJevDecisionsV2(info)&&access(info,(store,scope,lease)=>{
 if(info.name!=='jev')return false
 return store.loadConfiguration({...scope,account:'jev-recovery-v1'},lease)?.digest===configurationDigest(environment)
})

/** Long-lived lease: locking the vault closes precisely the configured child. */
export function connectPluginConfiguration(info:PluginInfo){
 if(!app.isReady()||info.cli!=='eas'||!info.config)throw Error('插件配置不可用')
 const lease=acquireConfigurationAccess(info)
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
 const lease=acquireConfigurationAccess(info)
 try{
  const scope={plugin:info.name,issuer:'eas:configuration:v1',resource:createHash('sha256').update(configurationIdentity(info)).digest('hex'),account:'local-primary'}
  const store=new PluginCredentialStore(path.join(fs.realpathSync(app.getPath('userData')),'plugin-credentials'))
  return connectBearerConfiguration({info,lease,fetch,load:()=>store.loadConfiguration(scope,lease)})
 }catch(error){lease.dispose();throw error}
}

/** Atomically replace current encrypted values, then revoke only this plugin's old leases. */
export function clearPluginConfiguration(info:PluginInfo){
 savePluginConfiguration(info,{})
 configurationLeases.invalidate(info.name)
}

/** Revocation can remove recovery evidence even if the vault has just locked. No decryption. */
export function forgetJevRecovery(info:PluginInfo){
 if(!app.isReady()||info.cli!=='eas'||info.name!=='jev'||!info.config)throw Error('插件配置不可用')
 const scope={plugin:info.name,issuer:'eas:configuration:v1',resource:createHash('sha256').update(configurationIdentity(info)).digest('hex'),account:'jev-recovery-v1'}
 new PluginCredentialStore(path.join(fs.realpathSync(app.getPath('userData')),'plugin-credentials')).removeConfiguration(scope)
}
