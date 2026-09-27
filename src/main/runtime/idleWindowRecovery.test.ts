import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import {runInNewContext} from 'node:vm'
import {EventEmitter} from 'node:events'
import {createRecoveryAdmission} from './recoveryAdmission.ts'
const source=fs.readFileSync(new URL('./idleWindowRecovery.ts',import.meta.url),'utf8').replace(/^import .*$/gm,'')
const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText
function fixture(mode='ok'){
 const handles=new Map<string,Function>(),ons=new Map<string,Function>(),gate=createRecoveryAdmission(),app=new EventEmitter()
 let serial=0,candidate:any;const windows:any[]=[]
 const win=(id:number)=>{
  const w:any=new EventEmitter();let destroyed=false
  const wc:any=new EventEmitter();Object.assign(wc,{id,getType:()=> 'window',debugger:{isAttached:()=>false},getOSProcessId:()=>id+100,send:(ch:string,r:any)=>{
   if(ch!=='idleRecovery:request')return
   queueMicrotask(()=>{
    if(r.action==='prepare')handles.get('idleRecovery:reply')!({sender:wc},r.id,{version:1,values:{}})
    if(r.action==='seal'){
     if(mode==='late-activity')gate.activity()
     if(mode==='crash-after-ready')candidate.webContents.emit('render-process-gone')
     let returned=false;const e:any={sender:wc};Object.defineProperty(e,'returnValue',{get:()=>returned,set:(value:boolean)=>{if(mode==='ok')assert.equal(destroyed,true,'sync reply must not unblock renderer before destruction');returned=value}});ons.get('idleRecovery:seal')!(e,r.attempt)
     if(!destroyed)handles.get('idleRecovery:reply')!({sender:wc},r.id,e.returnValue)
    }
   })
  }})
  Object.assign(w,{webContents:wc,isDestroyed:()=>destroyed,isFullScreen:()=>false,isMaximized:()=>false,isFocused:()=>false,isVisible:()=>false,isMinimized:()=>false,setBounds:()=>{},getBounds:()=>({}),showInactive:()=>{},destroy:()=>{if(id===1&&mode==='destroy-fail')throw Error('destroy failed');destroyed=true;windows.splice(windows.indexOf(w),1);w.emit('closed')}})
  windows.push(w);return w
 }
 const old=win(1),exports:any={}
 runInNewContext(code,{exports,Buffer,Error,JSON,Map,Promise,setTimeout,clearTimeout,Date,randomUUID:()=>String(++serial),BrowserWindow:{getAllWindows:()=>windows},app,webContents:{getAllWebContents:()=>windows.map(w=>w.webContents)},guardedHandle:(ch:string,fn:Function)=>handles.set(ch,fn),guardedOn:(ch:string,fn:Function)=>ons.set(ch,fn),recoveryAdmission:gate,mainWindow:()=>old,process:{env:{}}})
 const service=exports.installIdleWindowRecovery((o:any)=>{candidate=win(2);o.onCreated(candidate);queueMicrotask(()=>{if(mode==='ready-fail')handles.get('idleRecovery:ready')!({sender:candidate.webContents},false);else handles.get('idleRecovery:ready')!({sender:candidate.webContents},true)});return candidate},()=>true,gate.generation)
 return {service,old,gate,candidate:()=>candidate}
}
test('synchronous seal retires only after successful destruction and promotes restored process',async()=>{
 const f=fixture();assert.equal(await f.service.run(),true);assert.equal(f.old.isDestroyed(),true);assert.equal(f.candidate().isDestroyed(),false);assert.throws(()=>f.gate.enter(1,'agentChat:start'));f.gate.enter(2,'agentChat:start')();assert.notEqual(f.service.status().last.oldPid,f.service.status().last.newPid)
})
test('candidate failure and post-prepare activity preserve old window and its permissions',async()=>{
 for(const mode of ['ready-fail','late-activity','crash-after-ready']){const f=fixture(mode);assert.equal(await f.service.run(),false);assert.equal(f.old.isDestroyed(),false);assert.equal(f.candidate().isDestroyed(),true);f.gate.enter(1,'agentChat:start')()}
})
test('destruction exception leaves old sender usable instead of permanently retired',async()=>{
 const f=fixture('destroy-fail');assert.equal(await f.service.run(),false);assert.equal(f.old.isDestroyed(),false);f.gate.enter(1,'agentChat:start')()
})
