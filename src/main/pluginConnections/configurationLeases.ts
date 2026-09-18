type Lease={signal:AbortSignal;assertActive():void;dispose():void}
/** Revocation is plugin-scoped and irreversible for both dialogs and live connections. */
export class ConfigurationLeases {
 private readonly scopes=new Map<string,Set<AbortController>>()
 bind<T extends Lease>(name:string,lease:T):T{
  const controllers=this.scopes.get(name)??new Set<AbortController>(),controller=new AbortController()
  this.scopes.set(name,controllers);controllers.add(controller)
  const signal=AbortSignal.any([lease.signal,controller.signal])
  return {...lease,signal,assertActive:()=>{lease.assertActive();if(signal.aborted)throw Error('插件配置授权已失效')},dispose:()=>{
   controller.abort();controllers.delete(controller)
   if(!controllers.size&&this.scopes.get(name)===controllers)this.scopes.delete(name)
   lease.dispose()
  }}
 }
 invalidate(name:string){const controllers=this.scopes.get(name);this.scopes.delete(name);for(const c of controllers??[])c.abort()}
}
