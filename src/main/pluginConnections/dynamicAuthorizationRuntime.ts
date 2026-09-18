import type {FetchLike} from '@modelcontextprotocol/sdk/shared/transport.js'
import {DynamicAuthorizationManager} from './dynamicAuthorizationManager.ts'
import {createAuthenticatedFetch} from './authenticatedFetch.ts'
type Dependencies=ConstructorParameters<typeof DynamicAuthorizationManager>[0] & {fetch:FetchLike}
/** One approved plugin configuration, one local account slot (not a verified user identity). */
export class DynamicAuthorizationRuntime {
 private readonly deps:Dependencies
 private readonly manager:DynamicAuthorizationManager
 private readonly connections=new Set<ReturnType<typeof createAuthenticatedFetch>>()
 private closed=false
 constructor(deps:Dependencies){
  this.deps={...deps,config:{...deps.config,approvedOrigins:[...deps.config.approvedOrigins]}}
  this.manager=new DynamicAuthorizationManager(this.deps)
 }
 status():'disconnected'|'authorized'|'expired'|'locked-or-unavailable'{
  if(this.closed)return 'disconnected'
  let lease:ReturnType<Dependencies['acquire']>|undefined
  try{
   lease=this.deps.acquire();const token=this.deps.store.loadDynamicAuthorization(this.manager.scope,lease)?.tokens
   if(!token)return 'disconnected'
   return token.expires_in!==undefined&&token.expires_in<=0?'expired':'authorized'
  }catch{return 'locked-or-unavailable'}finally{lease?.dispose()}
 }
 login(){return this.manager.login()}
 connect(){
  if(this.closed)throw Error('插件授权运行时已关闭')
  const lease=this.deps.acquire()
  try{
   if(!this.deps.store.loadDynamicAuthorization(this.manager.scope,lease)?.tokens)throw Error('请先连接插件账号')
   const connection=createAuthenticatedFetch({url:this.deps.config.resource,lease,load:()=>this.deps.store.loadDynamicAuthorization(this.manager.scope,lease)?.tokens,refresh:()=>this.manager.refresh(),fetch:this.deps.fetch})
   this.connections.add(connection)
   connection.signal.addEventListener('abort',()=>this.connections.delete(connection),{once:true})
   return connection
  }catch(error){lease.dispose();throw error}
 }
 disconnect(){for(const connection of this.connections)connection.close();this.connections.clear();this.manager.disconnect()}
 close(){this.closed=true;for(const connection of this.connections)connection.close();this.connections.clear();this.manager.close()}
}
