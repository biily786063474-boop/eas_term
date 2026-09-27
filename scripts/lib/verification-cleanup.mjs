// Verification-only lifecycle helper. Never discovers or kills unrelated processes.
import {rm} from 'node:fs/promises'
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))
const transient=new Set(['EBUSY','EPERM','ENOTEMPTY','EMFILE','ENFILE'])
/** Subscribe immediately after spawn so early close is not missed in finally. */
export function observeChildClose(child){
 return new Promise(resolve=>child.once('close',resolve))
}
async function closedWithin(closed,ms){
 let timer
 try{return await Promise.race([closed.then(()=>true),new Promise(resolve=>{timer=setTimeout(()=>resolve(false),ms)})])}
 finally{clearTimeout(timer)}
}
/** exit / kill() is not proof that Chromium's profile handles are released.
 * Wait for owned close, then retry only transient filesystem contention, bounded.
 * On failure leave remaining evidence in place and fail verification explicitly. */
export async function cleanupVerificationProfile({app,childClosed,profile,graceMs=2000,forceMs=5000,maxRetries=6,retryDelayMs=200,remove=rm,pause=wait}){
 try{
  if(app.exitCode===null&&app.signalCode===null)app.kill('SIGTERM')
  if(!await closedWithin(childClosed,graceMs)){
   if(app.exitCode===null&&app.signalCode===null)app.kill('SIGKILL')
   if(!await closedWithin(childClosed,forceMs))throw Error('Owned process close was not observed')
  }
  for(let attempt=0;;attempt++){
   try{await remove(profile,{recursive:true,force:true});return}
   catch(error){
    if(!transient.has(error?.code)||attempt>=maxRetries)throw error
    await pause(retryDelayMs*(attempt+1))
   }
  }
 }catch(cause){
  throw new Error('Verification cleanup failed; remaining profile retained at '+profile,{cause})
 }
}
