/** Serializes saves and only clears dirty state after a successful acknowledgement.
 * This is a persistence prerequisite, NOT permission to reload a renderer. */
export function createSaveBarrier<T>(snapshot:()=>T,save:(value:T)=>Promise<boolean>){
 let revision=0,persisted=0,pending:Promise<boolean>|null=null
 const isDirty=()=>persisted<revision
 return {
  markDirty(){revision++},
  isDirty,
  flush():Promise<boolean>{
   if(pending)return pending
   pending=Promise.resolve().then(async()=>{
    while(isDirty()){
     const saving=revision
     try{if(await save(snapshot())!==true)return false}catch{return false}
     persisted=Math.max(persisted,saving)
    }
    return true
   }).finally(()=>{pending=null})
   return pending
  },
  flushSync(saveSync:(value:T)=>boolean):boolean{
   if(!isDirty())return true
   const saving=revision
   try{if(saveSync(snapshot())!==true)return false}catch{return false}
   persisted=Math.max(persisted,saving)
   return true
  }
 }
}
