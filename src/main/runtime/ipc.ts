import { guardedHandle } from '../ipcGuard'
import {sharedServices} from './sharedServices.ts'
import {ownedSessions} from './ownedSessions.ts'
import {recentActivity} from './recentActivity.ts'
import {installSessionStartup,queuedSessionStarts,cancelSessionStart} from './sessionStartup.ts'
import os from 'node:os'
import {runtimeStateStore} from './persistentState.ts'
import {runtimeProjectLabels} from '../../shared/runtimeProjectLabels.ts'
import { installPluginAdmission, observedPluginTasks, cancelPluginTask, observedPluginServices, stopObservedPlugin } from '../pluginHost.ts'
import { app, BrowserWindow, dialog } from 'electron'
import {createPlatformReader} from './readPlatformMetrics.ts'
import {createRuntimeController} from './controller.ts'
import {createStopGate} from './stopGate.ts'
/** Application-owned metrics and confirmed owned-plugin stop. Admission stays disabled until validated. */
export function registerRuntimeMonitor(projectsSource:()=>readonly {id:string;name:string}[]){
 const stopGate=createStopGate()
 guardedHandle('runtime:cancelTask',(event,id:unknown)=>{
  if(event.senderFrame!==event.sender.mainFrame||!BrowserWindow.fromWebContents(event.sender))throw Error('Only workbench may cancel its tasks')
  if(typeof id!=='string'||id.length>512)throw Error('invalid task id')
  return {ok:cancelSessionStart(id,event.sender.id)||cancelPluginTask(id,event.sender.id)}
 })
 guardedHandle('runtime:stopPlugin',async(event,id:unknown)=>{
  const win=BrowserWindow.fromWebContents(event.sender)
  if(event.senderFrame!==event.sender.mainFrame||!win)throw new Error('Only workbench may stop its plugins')
  if(typeof id!=='string'||id.length>512)throw new Error('invalid service id')
  const stop=(id.startsWith('lsp:')||id.startsWith('voice-asr:'))?sharedServices.stop:(id.startsWith('pty:')||id.startsWith('agent:')||id.startsWith('voice-vad:')||id.startsWith('voice-preview:')||id.startsWith('cli-login:')||id.startsWith('cli-install:'))?ownedSessions.stop:stopObservedPlugin
  return stopGate(id,()=>stop(id,event.sender.id,async(name,projects)=>{
   const result=await dialog.showMessageBox(win,{type:'question',buttons:['取消','关闭服务'],defaultId:0,cancelId:0,title:'关闭运行服务',message:'关闭 '+name+'？',detail:'将中断该服务当前操作，未保存的数据可能丢失。\n影响项目：'+(runtimeProjectLabels(projects,projectsSource()).join('、')||'项目归属未识别，可能仍有活动操作')})
   return result.response===1&&!win.isDestroyed()
  }))
 })
 let mode:'normal'|'eco'='eco'
 try{mode=runtimeStateStore.read().mode}catch{/* Corrupt state is not overwritten; mode changes must fail visibly. */}
 // 标题栏「等待 N」靠推送，不靠渲染层轮询。调度器一变就 200ms 合并一次广播给所有窗口。
 let waitingTimer: NodeJS.Timeout | undefined
 const broadcastWaiting = (): void => {
  if (waitingTimer) return
  waitingTimer = setTimeout(() => {
   waitingTimer = undefined
   const queued = controller.manager.snapshot().queued
   for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('runtime:waiting', { queued })
  }, 200)
  waitingTimer.unref()
 }
 const reader=createPlatformReader(),controller=createRuntimeController({mode,read:reader.read,now:()=>performance.now(),setTimer:(fn,ms)=>{const t=setTimeout(fn,ms);t.unref();return t},clearTimer:h=>clearTimeout(h as NodeJS.Timeout),onQueueChange:broadcastWaiting})
 guardedHandle('runtime:setMode',async(event,next:unknown)=>{
  if(event.senderFrame!==event.sender.mainFrame||!BrowserWindow.fromWebContents(event.sender))throw Error('Only workbench may change resource mode')
  if(next!=='normal'&&next!=='eco')throw Error('invalid mode')
  runtimeStateStore.write({...runtimeStateStore.read(),mode:next})
  controller.setMode(next)
  return {mode:next,threshold:next==='eco'?50:80}
 })
 // Unknown tool costs: one exploratory tool at a time, conservative nonzero reserve.
 // Entire agent sessions and approval/heartbeat control paths do not occupy this pool.
 installSessionStartup(controller.manager)
 installPluginAdmission(controller.manager,()=>({cpu:Math.max(5,100/Math.max(1,os.availableParallelism())),memoryBytes:512*1024**2}))
 controller.start()
 app.once('before-quit',()=>controller.dispose())
 app.once('will-quit',()=>sharedServices.shutdown())
 guardedHandle('runtime:waiting',async event=>{
  if(event.senderFrame!==event.sender.mainFrame||!BrowserWindow.fromWebContents(event.sender))throw new Error('Only workbench may read the queue')
  return { queued: controller.manager.snapshot().queued }
 })
 guardedHandle('runtime:monitor',async event=>{
  if(event.senderFrame!==event.sender.mainFrame||!BrowserWindow.fromWebContents(event.sender))throw new Error('Only workbench may read resource metrics')
  return {...controller.readForControl(),services:[...observedPluginServices(event.sender.id),...ownedSessions.list(event.sender.id),...sharedServices.list(event.sender.id)],tasks:[...observedPluginTasks(event.sender.id),...queuedSessionStarts(event.sender.id)],recent:recentActivity.list(event.sender.id)}
 })
}
