import {installIdleWindowRecovery} from './idleWindowRecovery.ts'
import {recoveryAdmission} from './recoveryAdmission.ts'
import {installIdleMemoryRecovery} from './idleMemoryRecovery.ts'
import {cliTurnQueue,onCliDispatchChange,cliDispatchTasks,cancelCliDispatchTask} from './cliDispatch.ts'
import {createProcessMetricsReader} from './processMetrics.ts'
import {createProcessTreeReader} from './processTree.ts'
import { guardedHandle } from '../ipcGuard'
import {sharedServices} from './sharedServices.ts'
import {ownedSessions} from './ownedSessions.ts'
import {recentActivity} from './recentActivity.ts'
import {installSessionStartup,queuedSessionStarts,cancelSessionStart} from './sessionStartup.ts'
import os from 'node:os'
import {runtimeStateStore} from './persistentState.ts'
import {runtimeProjectLabels} from '../../shared/runtimeProjectLabels.ts'
import { installPluginAdmission, observedPluginTasks, cancelPluginTask, observedPluginServices, stopObservedPlugin } from '../pluginHost.ts'
import { app, BrowserWindow, dialog, net } from 'electron'
import {createPlatformReader} from './readPlatformMetrics.ts'
import {createRuntimeController} from './controller.ts'
import {createStopGate} from './stopGate.ts'
import { t } from '../i18n.ts'
/** Application-owned metrics and confirmed owned-plugin stop. Admission stays disabled until validated. */
export function registerRuntimeMonitor(projectsSource:()=>readonly {id:string;name:string}[],factory?:Parameters<typeof installIdleWindowRecovery>[0]){
 const stopGate=createStopGate()
 const processMetrics=createProcessMetricsReader(()=>performance.now(),()=>app.getAppMetrics())
 const processTree=createProcessTreeReader(()=>performance.now(),process.pid)
 guardedHandle('runtime:cancelTask',(event,id:unknown)=>{
  if(event.senderFrame!==event.sender.mainFrame||!BrowserWindow.fromWebContents(event.sender))throw Error('Only workbench may cancel its tasks')
  if(typeof id!=='string'||id.length>512)throw Error('invalid task id')
  return {ok:cancelCliDispatchTask(id,event.sender.id)||cancelSessionStart(id,event.sender.id)||cancelPluginTask(id,event.sender.id)}
 })
 guardedHandle('runtime:stopPlugin',async(event,id:unknown)=>{
  const win=BrowserWindow.fromWebContents(event.sender)
  if(event.senderFrame!==event.sender.mainFrame||!win)throw new Error('Only workbench may stop its plugins')
  if(typeof id!=='string'||id.length>512)throw new Error('invalid service id')
  const stop=(id.startsWith('lsp:')||id.startsWith('voice-asr:'))?sharedServices.stop:(id.startsWith('pty:')||id.startsWith('agent:')||id.startsWith('voice-vad:')||id.startsWith('voice-preview:')||id.startsWith('cli-login:')||id.startsWith('cli-install:'))?ownedSessions.stop:stopObservedPlugin
  return stopGate(id,()=>stop(id,event.sender.id,async(name,projects)=>{
   const result=await dialog.showMessageBox(win,{type:'question',buttons:[t('dialogs.cancel'),t('dialogs.runtime.stopBtn')],defaultId:0,cancelId:0,title:t('dialogs.runtime.stopTitle'),message:t('dialogs.runtime.stopMsg',{name}),detail:t('dialogs.runtime.stopDetail',{projects:runtimeProjectLabels(projects,projectsSource()).join(t('dialogs.runtime.projectSep'))||t('dialogs.runtime.projectUnknown')})})
   return result.response===1&&!win.isDestroyed()
  }))
 })
 let mode:'normal'|'eco'='eco'
 // Offline is a local hint only: online does not prove provider reachability.
 const sampleNetwork=()=>cliTurnQueue.setOnline(net.isOnline())
 sampleNetwork()
 const networkTimer=setInterval(sampleNetwork,1000);networkTimer.unref()
 app.once('before-quit',()=>clearInterval(networkTimer))
 // Legacy cliConcurrency is intentionally ignored: only first-send spacing gates admission.
 guardedHandle('runtime:setCliConcurrency',async(event,value:unknown)=>{
  if(event.senderFrame!==event.sender.mainFrame||!BrowserWindow.fromWebContents(event.sender))throw Error('Only workbench may change concurrency')
  void value
  throw Error('已改为首次发送错峰，不再设置运行任务并发数')
 })
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
 let idleEnabled=false
 try{idleEnabled=runtimeStateStore.read().idleRecoveryEnabled??true}catch{/* unknown disabled */}
 let dispatchGeneration=0
 const offIdleDispatch=onCliDispatchChange(()=>{dispatchGeneration++})
 const idleDeps={enabled:()=>idleEnabled,generation:()=>dispatchGeneration+recentActivity.generation()+sharedServices.generation()+recoveryAdmission.generation(),idle:()=>!ownedSessions.hasAny()&&!sharedServices.hasAny()&&cliTurnQueue.snapshot().length===0&&controller.manager.details().length===0&&BrowserWindow.getAllWindows().every(w=>observedPluginTasks(w.webContents.id).length===0&&observedPluginServices(w.webContents.id).length===0)}
 const replacement=factory?installIdleWindowRecovery(factory,()=>idleDeps.enabled()&&idleDeps.idle()&&BrowserWindow.getAllWindows().every(w=>!w.isFocused()),idleDeps.generation):null
 const idleMemory=installIdleMemoryRecovery({...idleDeps,rebuild:()=>replacement?.run()??Promise.resolve(false)})
 app.once('before-quit',offIdleDispatch)
 guardedHandle('runtime:setIdleRecovery',(event,enabled:unknown)=>{
  if(event.senderFrame!==event.sender.mainFrame||!BrowserWindow.fromWebContents(event.sender)||typeof enabled!=='boolean')throw Error('invalid idle recovery setting')
  runtimeStateStore.write({...runtimeStateStore.read(),idleRecoveryEnabled:enabled});idleEnabled=enabled
  return {idleRecoveryEnabled:idleEnabled}
 })

 installPluginAdmission(controller.manager,()=>({cpu:Math.max(5,100/Math.max(1,os.availableParallelism())),memoryBytes:512*1024**2}))
 controller.start()
 app.once('before-quit',()=>{cliTurnQueue.dispose();controller.dispose()})
 app.once('will-quit',()=>sharedServices.shutdown())
 guardedHandle('runtime:waiting',async event=>{
  if(event.senderFrame!==event.sender.mainFrame||!BrowserWindow.fromWebContents(event.sender))throw new Error('Only workbench may read the queue')
  return { queued: controller.manager.snapshot().queued }
 })
 guardedHandle('runtime:monitor',async (event,includeProcesses:unknown=false)=>{
  if(typeof includeProcesses!=='boolean')throw Error('invalid diagnostic request')
  if(event.senderFrame!==event.sender.mainFrame||!BrowserWindow.fromWebContents(event.sender))throw new Error('Only workbench may read resource metrics')
  return {idleRecoveryEnabled:idleEnabled,idleMemory:idleMemory.status(),cliNetwork:cliTurnQueue.networkStatus(),cliConcurrency:cliTurnQueue.getLimit(),...controller.readForControl(),...(includeProcesses?{processes:processMetrics(),processTree:await processTree()}:{}),services:[...observedPluginServices(event.sender.id),...ownedSessions.list(event.sender.id),...sharedServices.list(event.sender.id)],tasks:[...observedPluginTasks(event.sender.id),...queuedSessionStarts(event.sender.id),...cliDispatchTasks(event.sender.id)],recent:recentActivity.list(event.sender.id)}
 })
}
