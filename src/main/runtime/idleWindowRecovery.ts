import {BrowserWindow,app,webContents} from 'electron'
import {randomUUID} from 'node:crypto'
import {guardedHandle,guardedOn} from '../ipcGuard'
import {recoveryAdmission} from './recoveryAdmission.ts'
import {mainWindow} from '../island'
interface Pending{sender:number;resolve:(value:unknown)=>void;timer:ReturnType<typeof setTimeout>}
type Factory=(options:{hidden:boolean;onCreated:(win:BrowserWindow)=>void})=>BrowserWindow
/** Candidate is hidden and task-incapable. The old window survives all failures. */
export function installIdleWindowRecovery(factory:Factory,eligible:()=>boolean,generation:()=>number){
 const replies=new Map<string,Pending>(),boot=new Map<number,unknown>(),ready=new Map<number,(ok:boolean)=>void>()
 let sealCommit:{sender:number;attempt:string;commit:()=>boolean}|null=null
 let running=false,closed=false,last:{at:number;oldPid:number;newPid:number}|null=null,lastFailure:string|null=null
 const request=(win:BrowserWindow,attempt:string,action:string)=>new Promise<unknown>(resolve=>{
  if(win.isDestroyed()){resolve(false);return}
  const id=randomUUID(),timer=setTimeout(()=>{replies.delete(id);resolve(false)},15000)
  replies.set(id,{sender:win.webContents.id,resolve,timer})
  win.webContents.send('idleRecovery:request',{id,attempt,action})
 })
 guardedHandle('idleRecovery:reply',(event,id:unknown,value:unknown)=>{
  if(typeof id!=='string')return false
  const pending=replies.get(id)
  if(!pending||pending.sender!==event.sender.id)return false
  replies.delete(id);clearTimeout(pending.timer);pending.resolve(value);return true
 })
 guardedHandle('idleRecovery:bootstrap',event=>{
  if(!recoveryAdmission.isCandidate(event.sender.id)||!boot.has(event.sender.id))return null
  const snapshot=boot.get(event.sender.id);boot.delete(event.sender.id);return snapshot
 })
 guardedHandle('idleRecovery:ready',(event,ok:unknown)=>{
  if(!recoveryAdmission.isCandidate(event.sender.id))return false
  ready.get(event.sender.id)?.(ok===true);return true
 })
 guardedOn('idleRecovery:seal',(event,attempt:unknown)=>{
  const commit=sealCommit,sender=event.sender.id
  if(commit&&commit.sender===sender&&commit.attempt===attempt){
   sealCommit=null
   let ok=false
   try{ok=commit.commit()}catch(error){lastFailure=error instanceof Error?error.message:'commit-failed'}
   event.returnValue=ok
   for(const [id,p] of replies)if(p.sender===sender){clearTimeout(p.timer);replies.delete(id);p.resolve(ok)}
  }else event.returnValue=false
 })
 guardedHandle('idleRecovery:activity',()=>{recoveryAdmission.activity();return true})
 const fullyIdle=()=>eligible()&&BrowserWindow.getAllWindows().filter(w=>!recoveryAdmission.isCandidate(w.webContents.id)).length===1&&webContents.getAllWebContents().every(w=>w.getType()==='window'&&!w.debugger.isAttached())
 const run=async():Promise<boolean>=>{
  if(running||closed)return false
  const old=mainWindow()
  if(!old||old.isDestroyed()||old.isFullScreen()||old.isMaximized()||!fullyIdle()||recoveryAdmission.pending()){lastFailure='precondition:'+JSON.stringify({window:!!old,fullscreen:old?.isFullScreen(),maximized:old?.isMaximized(),idle:fullyIdle(),pending:recoveryAdmission.pending()});return false}
  running=true;lastFailure=null
  let candidate:BrowserWindow|undefined,candidateId:number|undefined,committed=false,candidateFailed=false
  const attempt=randomUUID(),start=generation()
  const current=()=>!closed&&!old.isDestroyed()&&!old.isFocused()&&fullyIdle()&&generation()===start&&recoveryAdmission.pending()===0
  try{
   const snapshot=await request(old,attempt,'prepare')
   if(!snapshot||typeof snapshot!=='object'||Buffer.byteLength(JSON.stringify(snapshot))>16*1024*1024||!current()){lastFailure='prepare-or-activity';return false}
   let resolveReady!:(ok:boolean)=>void
   const loaded=new Promise<boolean>(resolve=>{resolveReady=resolve})
   candidate=factory({hidden:true,onCreated:win=>{
    candidateId=win.webContents.id
    recoveryAdmission.candidate(candidateId);boot.set(candidateId,snapshot);ready.set(candidateId,resolveReady)
    const failed=()=>{candidateFailed=true;resolveReady(false)}
    win.setBounds(old.getBounds());win.on('closed',failed);win.webContents.on('render-process-gone',failed)
   }})
   let timeout:ReturnType<typeof setTimeout>|undefined
   const loadedOk=await Promise.race([loaded,new Promise<false>(resolve=>{timeout=setTimeout(()=>resolve(false),20000)})]).finally(()=>clearTimeout(timeout))
   if(!loadedOk||candidateFailed||candidate.isDestroyed()||!current()){lastFailure='candidate-or-activity';return false}
   const finalize=()=>{
    if(!current()||candidateFailed||!candidate||candidate.isDestroyed())return false
    const oldId=old.webContents.id,oldPid=old.webContents.getOSProcessId(),newPid=candidate.webContents.getOSProcessId()
    if(newPid<=0||oldPid===newPid)return false
    const visible=old.isVisible(),minimized=old.isMinimized()
    // Called synchronously by the old renderer: it cannot edit after its final
    // token check while main retires it. No promise/event-loop gap at commit.
    old.destroy()
    committed=true
    recoveryAdmission.retire(oldId);recoveryAdmission.promote(candidate.webContents.id)
    candidate.webContents.send('idleRecovery:activate')
    if(visible&&!minimized)candidate.showInactive()
    last={at:Date.now(),oldPid,newPid};return true
   }
   sealCommit={sender:old.webContents.id,attempt,commit:finalize}
   await request(old,attempt,'seal')
   if(!committed)lastFailure='seal-or-activity'
   return committed
  }catch(error){lastFailure=error instanceof Error?error.message:'rebuild-failed';return false}
  finally{
   sealCommit=null
   if(candidateId!==undefined){boot.delete(candidateId);ready.delete(candidateId)}
   if(!committed){
    if(candidate&&!candidate.isDestroyed()){recoveryAdmission.retire(candidate.webContents.id);candidate.destroy()}
    if(!old.isDestroyed())old.webContents.send('idleRecovery:request',{id:'',attempt,action:'cancel'})
   }
   running=false
  }
 }
 guardedHandle('idleRecovery:status',()=>({running,last,lastFailure}))
 guardedHandle('idleRecovery:test',event=>{
  if(process.env.EAS_VERIFY!=='1'||recoveryAdmission.isCandidate(event.sender.id))throw Error('verification only')
  const win=BrowserWindow.fromWebContents(event.sender)
  win?.unmaximize();win?.setBounds({width:1000,height:700});win?.hide()
  setTimeout(()=>void run(),100)
  return true
 })
 app.once('before-quit',()=>{closed=true;for(const p of replies.values()){clearTimeout(p.timer);p.resolve(false)}replies.clear();for(const resolve of ready.values())resolve(false)})
 return {run,status:()=>({running,last,lastFailure})}
}
