import {prepareRendererRecovery,restoreRendererRecovery} from './workspaceRecoveryAdapter'
import {recoveryRegistry,setRecoveryTransferring} from './rendererRecovery'
import type {RecoveryStateSnapshot} from './recoveryState'
/** No renderer initiated production restart. It only answers main-owned requests. */
export async function bootWithRecovery(mount:()=>void){
 let candidate=window.api.idleRecovery.candidate
 let prepared:Awaited<ReturnType<typeof prepareRendererRecovery>>=null,attempt=''
 window.api.idleRecovery.onActivate(()=>{candidate=false;setRecoveryTransferring(false)})
 window.api.idleRecovery.onRequest(request=>{void (async()=>{
  if(request.action==='cancel'){if(attempt===request.attempt){prepared=null;setRecoveryTransferring(false)}return}
  let result:unknown=false
  try{
   if(!candidate&&request.action==='prepare'){
    attempt=request.attempt;prepared=await prepareRendererRecovery()
    if(attempt===request.attempt)result=prepared?.snapshot??false
   }else if(!candidate&&request.action==='seal'&&attempt===request.attempt&&prepared&&recoveryRegistry.current(prepared.token)){
    setRecoveryTransferring(true);result=window.api.idleRecovery.seal(attempt)
   }
  }catch{result=false}
  await window.api.idleRecovery.reply(request.id,result).catch(()=>{})
 })()})
 let lastInput=0
 const changed=()=>{
  recoveryRegistry.changed()
  if(candidate)return
  const now=performance.now();if(now-lastInput<200)return;lastInput=now
  void window.api.idleRecovery.activity().catch(()=>{})
 }
 for(const event of ['input','keydown','pointerdown','wheel'])document.addEventListener(event,changed,{capture:true,passive:true})
 if(!candidate){mount();return}
 // While staged, even a failed render/unmount cannot delete original attachments.
 setRecoveryTransferring(true)
 try{
  const snapshot=await window.api.idleRecovery.bootstrap() as RecoveryStateSnapshot
  restoreRendererRecovery(snapshot)
  mount()
  // A DOM-ready event alone does not prove state hooks / history load are ready.
  const expected=JSON.stringify(snapshot.values.workspace)
  for(let i=0;i<120;i++){
   await new Promise(resolve=>setTimeout(resolve,100))
   const preparedCandidate=await prepareRendererRecovery()
   if(preparedCandidate){
    const same=JSON.stringify(preparedCandidate.snapshot.values.workspace)===expected
    await window.api.idleRecovery.ready(same);return
   }
  }
  await window.api.idleRecovery.ready(false)
 }catch{await window.api.idleRecovery.ready(false).catch(()=>{})}
}
