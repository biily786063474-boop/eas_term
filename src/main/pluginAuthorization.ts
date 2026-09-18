import {app,session,shell} from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type {PluginInfo} from '../shared/types'
import {acquirePluginCredentialAccess} from './secrets'
import {PluginCredentialStore} from './pluginConnections/credentialStore.ts'
import {PluginAuthorizationRuntime} from './pluginConnections/authorizationRuntime.ts'
import {DynamicAuthorizationRuntime} from './pluginConnections/dynamicAuthorizationRuntime.ts'
import {discoverPluginOAuth} from './pluginConnections/oauthDiscovery.ts'
import {authorizePlugin,authorizeDynamicPlugin,refreshPluginAuthorization} from './pluginConnections/oauthAuthorization.ts'
import {createPluginNetwork} from './pluginConnections/pluginNetwork.ts'
const runtimes=new Map<string,{key:string;runtime:PluginAuthorizationRuntime|DynamicAuthorizationRuntime}>()
let watchingQuit=false
/** Main-owned fixed storage and installed manifest only; no renderer URLs or paths. */
export function getPluginAuthorization(info:PluginInfo){
 if(!app.isReady()||info.cli!=='eas'||info.remote?.auth!=='oauth')throw Error('此插件未配置OAuth')
 const remote=info.remote,key=JSON.stringify(remote),existing=runtimes.get(info.name)
 if(existing?.key===key)return existing.runtime
 existing?.runtime.close()
 const directory=path.join(fs.realpathSync(app.getPath('userData')),'plugin-credentials')
 const config={...remote.oauth,resource:remote.url,approvedOrigins:[...remote.approvedOrigins]}
 const fetch=createPluginNetwork(config.approvedOrigins,session.defaultSession)
 const common={plugin:info.name,acquire:acquirePluginCredentialAccess,store:new PluginCredentialStore(directory),fetch}
 const openBrowser=(authorizationEndpoint:string)=>async(url:string)=>{
  const target=new URL(url),approved=new URL(authorizationEndpoint)
  if(target.origin!==approved.origin||target.pathname!==approved.pathname||target.username||target.password||target.hash)throw Error('授权浏览器目标无效')
  await shell.openExternal(target.href)
 }
 const refresh=(settings:Parameters<typeof refreshPluginAuthorization>[0],token:string,signal:AbortSignal)=>refreshPluginAuthorization(settings,token,{fetch,signal})
 const runtime=config.registrationEndpoint!==undefined
  ?new DynamicAuthorizationRuntime({...common,config:{...config,registrationEndpoint:config.registrationEndpoint},refresh,
   authorize:async(settings,signal)=>{
    const discovered=await discoverPluginOAuth(settings,{fetch,signal})
    // Discovery verifies capabilities, never grants a new endpoint (even on an approved origin).
    for(const key of ['issuer','resource','authorizationEndpoint','tokenEndpoint','registrationEndpoint'] as const){
     if(!discovered[key]||new URL(discovered[key]).href!==new URL(settings[key]).href)throw Error('OAuth发现与已批准插件端点不一致')
    }
    if(signal.aborted)throw Error('插件授权已取消')
    return authorizeDynamicPlugin(settings,{fetch,signal,openBrowser:openBrowser(settings.authorizationEndpoint)})
   }})
  :new PluginAuthorizationRuntime({...common,config:{...config,clientId:config.clientId!},refresh,
   authorize:(settings,signal)=>authorizePlugin(settings,{fetch,signal,openBrowser:openBrowser(settings.authorizationEndpoint)})})
 runtimes.set(info.name,{key,runtime})
 if(!watchingQuit){watchingQuit=true;app.on('before-quit',()=>{for(const entry of runtimes.values())entry.runtime.close();runtimes.clear()})}
 return runtime
}

/** Called only after the package mutation gate, before synchronous replacement/deletion. */
export function invalidatePluginAuthorization(name:string,removeCredentials=false):void{
 if(!/^[a-z0-9][a-z0-9-]{0,39}$/.test(name))throw Error('插件身份无效')
 runtimes.get(name)?.runtime.close();runtimes.delete(name)
 if(removeCredentials){
  if(!app.isReady())throw Error('应用尚未就绪')
  new PluginCredentialStore(path.join(fs.realpathSync(app.getPath('userData')),'plugin-credentials')).removePlugin(name)
 }
}
