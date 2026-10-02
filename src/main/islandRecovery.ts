/** One main-process wakeup per failure; renderer activity is not a recovery clock. */
export function createIslandRecovery(reconcile:()=>void){
 let timer:ReturnType<typeof setTimeout>|undefined
 return {
  schedule(){
   if(timer)return
   timer=setTimeout(()=>{timer=undefined;reconcile()},3000)
   timer.unref()
  },
  cancel(){clearTimeout(timer);timer=undefined}
 }
}
