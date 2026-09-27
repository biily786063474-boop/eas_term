import {collectIdleGarbage} from './idleGarbageCollection.ts'
import {app,BrowserWindow,webContents} from 'electron'
import {createIdleRecoveryPolicy} from './idleRecoveryPolicy.ts'

/** Non-destructive phase: collect unreachable JS objects, never reload or kill.
 * An attached debugger, guest, foreground window or unknown activity vetoes work.
 */
export function installIdleMemoryRecovery(deps:{idle:()=>boolean;generation:()=>number;enabled:()=>boolean}) {
 const policy=createIdleRecoveryPolicy()
 let busy=false,closed=false,lastRunAt:number|null=null,lastError=false
 const eligible=()=>deps.enabled()&&deps.idle()&&BrowserWindow.getAllWindows().every(w=>!w.isFocused())&&webContents.getAllWebContents().every(w=>w.getType()==='window'&&!w.debugger.isAttached())
 const tick=async()=>{
  if(busy||closed)return
  let ready=false
  try{ready=eligible()}catch{/* unknown veto */}
  if(!policy.observe({at:performance.now(),background:ready,knownIdle:ready,enabled:ready,generation:deps.generation()}))return
  busy=true
  const generation=deps.generation()
  try{
   for(const win of BrowserWindow.getAllWindows()){
    if(closed||!eligible()||deps.generation()!==generation)break
    const wc=win.webContents
    if(wc.isDestroyed()||wc.debugger.isAttached())continue
    const current=()=>!closed&&!wc.isDestroyed()&&BrowserWindow.getAllWindows().every(w=>!w.isFocused())&&deps.enabled()&&deps.idle()&&deps.generation()===generation
    if(await collectIdleGarbage(wc.debugger,current)){lastRunAt=Date.now();lastError=false}
   }
  }catch{lastError=true}
  finally{busy=false}
 }
 const timer=setInterval(()=>void tick(),30000);timer.unref()
 const reset=()=>policy.reset()
 app.on('browser-window-focus',reset)
 const dispose=()=>{closed=true;clearInterval(timer);app.removeListener('browser-window-focus',reset)}
 app.once('before-quit',dispose)
 return {status:()=>({lastRunAt,lastError,busy}),dispose}
}
