import type {authorizePlugin} from './oauthAuthorization.ts'
import type {OAuthTokens} from '@modelcontextprotocol/sdk/shared/auth.js'
import type {CredentialScope,CredentialProtection,PluginCredentialStore} from './credentialStore.ts'
type Config=Parameters<typeof authorizePlugin>[0]
type Lease=CredentialProtection & {signal:AbortSignal;dispose():void}
interface Dependencies {
 acquire:()=>Lease
 store:Pick<PluginCredentialStore,'save'|'remove'> & Partial<Pick<PluginCredentialStore,'load'>>
 refresh?:(config:Config,refreshToken:string,signal:AbortSignal)=>Promise<OAuthTokens>
 authorize:(config:Config,signal:AbortSignal)=>Promise<OAuthTokens>
}
/** Only host-trusted configuration may enter this manager. No renderer secrets or paths. */
export class PluginAuthorizationManager {
 private closed=false
 private readonly deps:Dependencies
 private readonly pending=new Map<string,{kind:'login'|'refresh';controller:AbortController;result:Promise<{authorized:true}>}>()
 constructor(deps:Dependencies){this.deps=deps}
 private key(scope:CredentialScope){return JSON.stringify([scope.plugin,scope.issuer,scope.resource,scope.account])}
 login(scope:CredentialScope,config:Config):Promise<{authorized:true}>{return this.run(scope,config,'login')}
 refresh(scope:CredentialScope,config:Config):Promise<{authorized:true}>{return this.run(scope,config,'refresh')}
 private run(scope:CredentialScope,config:Config,kind:'login'|'refresh'):Promise<{authorized:true}>{
  if(this.closed)return Promise.reject(Error('授权管理器已关闭'))
  if(scope.issuer!==config.issuer||scope.resource!==config.resource)return Promise.reject(Error('授权作用域与配置不匹配'))
  const bound={...scope},key=this.key(bound)
  const existing=this.pending.get(key)
  if(existing){
   if(kind==='refresh'||existing.kind==='login')return existing.result
   existing.controller.abort();this.pending.delete(key)
  }
  let lease:Lease
  try{lease=this.deps.acquire()}catch{return Promise.reject(Error('请先解锁密钥柜'))}
  const controller=new AbortController()
  const signal=AbortSignal.any([controller.signal,lease.signal])
  const result=(async()=>{
   try {
    const settings={...config,approvedOrigins:[...config.approvedOrigins]}
    let tokens:OAuthTokens
    if(kind==='login')tokens=await this.deps.authorize(settings,signal)
    else {
     const refreshToken=this.deps.store.load?.(bound,lease)?.refresh_token
     if(!refreshToken||!this.deps.refresh)throw Error('需要重新授权')
     tokens=await this.deps.refresh(settings,refreshToken,signal)
    }
    lease.assertActive()
    if(signal.aborted)throw Error('授权已取消')
    this.deps.store.save(bound,tokens,lease)
    return {authorized:true as const}
   }catch{throw Error('授权未完成或会话已失效')}
   finally {lease.dispose()}
  })().finally(()=>{if(this.pending.get(key)?.controller===controller)this.pending.delete(key)})
  this.pending.set(key,{kind,controller,result})
  return result
 }
 disconnect(scope:CredentialScope){
  const key=this.key(scope);this.pending.get(key)?.controller.abort();this.pending.delete(key)
  this.deps.store.remove(scope)
 }
 close(){this.closed=true;for(const item of this.pending.values())item.controller.abort();this.pending.clear()}
}
