import type {authorizePlugin} from './oauthAuthorization.ts'
import type {OAuthTokens} from '@modelcontextprotocol/sdk/shared/auth.js'
import type {CredentialScope,CredentialProtection,PluginCredentialStore} from './credentialStore.ts'
type Config=Parameters<typeof authorizePlugin>[0]
type Lease=CredentialProtection & {signal:AbortSignal;dispose():void}
interface Dependencies {
 acquire:()=>Lease
 store:Pick<PluginCredentialStore,'save'|'remove'>
 authorize:(config:Config,signal:AbortSignal)=>Promise<OAuthTokens>
}
/** Only host-trusted configuration may enter this manager. No renderer secrets or paths. */
export class PluginAuthorizationManager {
 private closed=false
 private readonly deps:Dependencies
 private readonly pending=new Map<string,{controller:AbortController;result:Promise<{authorized:true}>}>()
 constructor(deps:Dependencies){this.deps=deps}
 private key(scope:CredentialScope){return JSON.stringify([scope.plugin,scope.issuer,scope.resource,scope.account])}
 login(scope:CredentialScope,config:Config):Promise<{authorized:true}>{
  if(this.closed)return Promise.reject(Error('授权管理器已关闭'))
  if(scope.issuer!==config.issuer||scope.resource!==config.resource)return Promise.reject(Error('授权作用域与配置不匹配'))
  const bound={...scope},key=this.key(bound)
  const existing=this.pending.get(key);if(existing)return existing.result
  let lease:Lease
  try{lease=this.deps.acquire()}catch{return Promise.reject(Error('请先解锁密钥柜'))}
  const controller=new AbortController()
  const signal=AbortSignal.any([controller.signal,lease.signal])
  const result=(async()=>{
   try {
    const tokens=await this.deps.authorize({...config,approvedOrigins:[...config.approvedOrigins]},signal)
    lease.assertActive()
    if(signal.aborted)throw Error('授权已取消')
    this.deps.store.save(bound,tokens,lease)
    return {authorized:true as const}
   }catch{throw Error('授权未完成或会话已失效')}
   finally {lease.dispose()}
  })().finally(()=>{if(this.pending.get(key)?.controller===controller)this.pending.delete(key)})
  this.pending.set(key,{controller,result})
  return result
 }
 disconnect(scope:CredentialScope){
  const key=this.key(scope);this.pending.get(key)?.controller.abort();this.pending.delete(key)
  this.deps.store.remove(scope)
 }
 close(){this.closed=true;for(const item of this.pending.values())item.controller.abort();this.pending.clear()}
}
