import {createHash} from 'node:crypto'
import type {authorizeDynamicPlugin,PluginOAuthConfig} from './oauthAuthorization.ts'
import type {OAuthTokens} from '@modelcontextprotocol/sdk/shared/auth.js'
import type {CredentialScope,CredentialProtection,PluginCredentialStore} from './credentialStore.ts'
type Config=Parameters<typeof authorizeDynamicPlugin>[0]
type RecordValue=Awaited<ReturnType<typeof authorizeDynamicPlugin>>
type Lease=CredentialProtection & {signal:AbortSignal;dispose():void}
interface Dependencies {
 plugin:string;config:Config;acquire:()=>Lease
 store:Pick<PluginCredentialStore,'saveDynamicAuthorization'|'loadDynamicAuthorization'|'removeDynamicAuthorization'>
 authorize:(config:Config,signal:AbortSignal)=>Promise<RecordValue>
 refresh:(config:PluginOAuthConfig,refreshToken:string,signal:AbortSignal)=>Promise<OAuthTokens>
}
/** Main-process-only orchestrator. No tokens or client identities in action results.
 * A later runtime owns authenticated connections and must close them on disconnect.
 */
export class DynamicAuthorizationManager {
 readonly scope:Readonly<CredentialScope>
 private readonly config:Config
 private readonly deps:Dependencies
 private closed=false
 private pending?:{kind:'login'|'refresh';controller:AbortController;result:Promise<{authorized:true}>}
 constructor(deps:Dependencies){
  this.deps=deps;this.config={...deps.config,approvedOrigins:[...deps.config.approvedOrigins]}
  const binding=createHash('sha256').update(JSON.stringify(this.config)).digest('hex')
  this.scope=Object.freeze({plugin:deps.plugin,issuer:this.config.issuer,resource:this.config.resource,account:'dynamic:'+binding})
 }
 login(){return this.run('login')}
 refresh(){return this.run('refresh')}
 private run(kind:'login'|'refresh'):Promise<{authorized:true}>{
  if(this.closed)return Promise.reject(Error('动态授权管理器已关闭'))
  if(this.pending){
   if(kind==='refresh'||this.pending.kind==='login')return this.pending.result
   this.pending.controller.abort();this.pending=undefined
  }
  let lease:Lease
  try{lease=this.deps.acquire()}catch{return Promise.reject(Error('请先解锁密钥柜'))}
  const controller=new AbortController(),signal=AbortSignal.any([controller.signal,lease.signal])
  // Defer execution until pending is installed, including synchronous dependency failures.
  const result=Promise.resolve().then(async()=>{
   try{
    lease.assertActive();if(signal.aborted)throw Error('已取消')
    const config={...this.config,approvedOrigins:[...this.config.approvedOrigins]}
    let record:RecordValue
    if(kind==='login')record=await this.deps.authorize(config,signal)
    else{
     const saved=this.deps.store.loadDynamicAuthorization(this.scope,lease)
     if(!saved?.tokens.refresh_token)throw Error('需要重新授权')
     const tokens=await this.deps.refresh({...config,clientId:saved.clientId},saved.tokens.refresh_token,signal)
     record={clientId:saved.clientId,tokens:{...tokens,refresh_token:tokens.refresh_token??saved.tokens.refresh_token}}
    }
    lease.assertActive();if(signal.aborted)throw Error('已取消')
    this.deps.store.saveDynamicAuthorization(this.scope,record,lease)
    return {authorized:true as const}
   }catch{throw Error('动态授权未完成或会话已失效')}
   finally{lease.dispose()}
  }).finally(()=>{if(this.pending?.controller===controller)this.pending=undefined})
  this.pending={kind,controller,result};return result
 }
 disconnect(){this.pending?.controller.abort();this.pending=undefined;this.deps.store.removeDynamicAuthorization(this.scope)}
 close(){this.closed=true;this.pending?.controller.abort();this.pending=undefined}
}
