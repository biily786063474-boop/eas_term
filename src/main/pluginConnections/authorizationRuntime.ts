import {createHash} from 'node:crypto'
import type {FetchLike} from '@modelcontextprotocol/sdk/shared/transport.js'
import type {OAuthTokens} from '@modelcontextprotocol/sdk/shared/auth.js'
import type {PluginOAuthConfig} from './oauthAuthorization.ts'
import type {PluginCredentialStore,CredentialProtection,CredentialScope} from './credentialStore.ts'
import {PluginAuthorizationManager} from './authorizationManager.ts'
import {createAuthenticatedFetch} from './authenticatedFetch.ts'
interface Dependencies {
 plugin:string;config:PluginOAuthConfig
 acquire:()=>CredentialProtection & {signal:AbortSignal;dispose():void}
 store:Pick<PluginCredentialStore,'load'|'save'|'remove'>
 authorize:(config:PluginOAuthConfig,signal:AbortSignal)=>Promise<OAuthTokens>
 refresh:(config:PluginOAuthConfig,token:string,signal:AbortSignal)=>Promise<OAuthTokens>
 fetch:FetchLike
}
/** One approved plugin configuration, one local account slot (not a verified user identity). */
export class PluginAuthorizationRuntime {
 private readonly deps:Dependencies
 private readonly scope:CredentialScope
 private readonly manager:PluginAuthorizationManager
 private readonly connections=new Set<ReturnType<typeof createAuthenticatedFetch>>()
 private closed=false
 constructor(deps:Dependencies){
  this.deps={...deps,config:{...deps.config,approvedOrigins:[...deps.config.approvedOrigins]}}
  // Changing client/scopes/endpoints must not silently reuse a prior consent's token.
  const binding=createHash('sha256').update(JSON.stringify(this.deps.config)).digest('hex')
  this.scope={plugin:deps.plugin,issuer:deps.config.issuer,resource:deps.config.resource,account:'primary:'+binding}
  this.manager=new PluginAuthorizationManager(deps)
 }
 status():'disconnected'|'authorized'|'expired'|'locked-or-unavailable'{
  if(this.closed)return 'disconnected'
  let lease:ReturnType<Dependencies['acquire']>|undefined
  try{
   lease=this.deps.acquire();const token=this.deps.store.load(this.scope,lease)
   if(!token)return 'disconnected'
   return token.expires_in!==undefined&&token.expires_in<=0?'expired':'authorized'
  }catch{return 'locked-or-unavailable'}finally{lease?.dispose()}
 }
 login(){return this.manager.login(this.scope,this.deps.config)}
 connect(){
  if(this.closed)throw Error('插件授权运行时已关闭')
  const lease=this.deps.acquire()
  try{
   if(!this.deps.store.load(this.scope,lease))throw Error('请先连接插件账号')
   const connection=createAuthenticatedFetch({url:this.deps.config.resource,lease,load:()=>this.deps.store.load(this.scope,lease),refresh:()=>this.manager.refresh(this.scope,this.deps.config),fetch:this.deps.fetch})
   this.connections.add(connection)
   connection.signal.addEventListener('abort',()=>this.connections.delete(connection),{once:true})
   return connection
  }catch(error){lease.dispose();throw error}
 }
 disconnect(){for(const connection of this.connections)connection.close();this.connections.clear();this.manager.disconnect(this.scope)}
 close(){this.closed=true;for(const connection of this.connections)connection.close();this.connections.clear();this.manager.close()}
}
