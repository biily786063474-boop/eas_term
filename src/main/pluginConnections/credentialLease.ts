/** Main-process leases: invalidation is irreversible, even if the vault unlocks again. */
export class CredentialLeases {
 private readonly controllers=new Set<AbortController>()
 private readonly unlocked:()=>boolean
 constructor(unlocked:()=>boolean){this.unlocked=unlocked}
 invalidate(){for(const controller of this.controllers)controller.abort();this.controllers.clear()}
 acquire(){
  if(!this.unlocked()){this.invalidate();throw Error('密钥柜已锁定')}
  const controller=new AbortController();this.controllers.add(controller)
  const dispose=()=>{this.controllers.delete(controller);controller.abort()}
  return {
   signal:controller.signal,
   assertActive:()=>{
    if(!this.unlocked())this.invalidate()
    if(controller.signal.aborted)throw Error('插件凭证会话已失效')
   },
   dispose
  }
 }
}
