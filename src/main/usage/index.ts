import { tm } from '../../shared/i18n/current.ts'
import { activityStore, captureActivity, flushActivity } from './activityCapture.ts'
import { activitySnapshot } from './activity.ts'
// App-owned persistence only; no caller-selected ledger path or network traffic.
import { guardedHandle, guardedOn } from '../ipcGuard'
import { app, dialog, BrowserWindow, nativeImage, clipboard } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { guardPath } from '../fsGuard'
import { projectRootOf } from '../../shared/roleWorktree.ts'
import type { ChatEvent } from '../../shared/agentChat.ts'
import type { SessionRecord } from '../agentChat/sessionState.ts'
import { UsageBook } from './core.ts'
import { loadLedger, saveLedger, queryLedger, validateQuery, csvOf } from './storage.ts'
import { t } from '../i18n.ts'
const book = new UsageBook()
let since=Date.now(), error:string|undefined, disabled=false, initialized=false
let timer:ReturnType<typeof setTimeout>|undefined
let writing=Promise.resolve()
const file=():string=>path.join(app.getPath('userData'),'usage-ledger.json')
function init():void {
 if(initialized) return; initialized=true
 try {const d=loadLedger(file()); since=d.since;book.rows=d.rows;book.prune(Date.now())}
 catch(e){error=String(e);disabled=true}
}
function schedule():void {
 if(disabled||timer) return
 timer=setTimeout(()=>{timer=undefined;void flush()},300)
}
async function flush():Promise<void> {
 if(disabled) return
 book.prune(Date.now())
 const data=JSON.parse(JSON.stringify({version:1,since,rows:book.rows}))
 writing=writing.then(()=>saveLedger(file(),data)).then(()=>{error=undefined},e=>{error=tm('errCore.usage.saveFailed', { error: String(e) })})
 await writing
}
export function resetUsageCost(session:string):void {book.resetCost(session)}
export function captureUsage(rec:SessionRecord,e:ChatEvent):void {
 try {
  init(); if(disabled)return
  if(e.k==='turn.start') {
   const root=projectRootOf(rec.cwd)
   let project=root,projectName=path.basename(root)||'未归属项目'
   try {
    const ps=JSON.parse(fs.readFileSync(path.join(app.getPath('userData'),'projects.json'),'utf8')) as {path:string;name:string}[]
    const p=ps.filter(p=>typeof p.path==='string'&&(root===p.path||root.startsWith(p.path+path.sep))).sort((a,b)=>b.path.length-a.path.length)[0]
    if(p){project=p.path;projectName=typeof p.name==='string'?p.name:projectName}
   }catch{/* Unregistered cwd keeps its own stable path identity. */}
   captureActivity('chat')
   book.start({session:rec.id,project,projectName,cli:rec.cli,model:rec.pending?.model||rec.model||'未上报'},randomUUID(),Date.now())
  } else if(e.k==='turn.done') {
   book.finish(rec.id,e.meter,rec.cli==='claude'?e.costUsd:undefined,Date.now(),e.interrupted?'interrupted':'completed')
  } else if(e.k==='error'&&e.fatal) {
   book.abort(rec.id,Date.now())
  } else return
  schedule()
 }catch(e){error=tm('errCore.usage.collectFailed', { error: String(e) })}
}
export function markUsageInterrupted(rec:SessionRecord):void {book.markInterrupted(rec.id)}
export function interruptUsage(rec:SessionRecord):void {
 try {init();book.abort(rec.id,Date.now());schedule()}catch(e){error=String(e)}
}
export function registerUsageHandlers():void {
 init()
 activityStore()
 void flushActivity() // Persist the collection start even before the first action.
 const trusted=(e:Electron.IpcMainInvokeEvent):void=>{
  const win=BrowserWindow.fromWebContents(e.sender)
  if(!win||e.senderFrame!==e.sender.mainFrame)throw new Error(tm('errCore.usage.mainOnly'))
 }
 guardedOn('usage:activityEvent',(e,key:unknown)=>{
  if(!BrowserWindow.fromWebContents(e.sender)||e.senderFrame!==e.sender.mainFrame)return
  // Chat and plugin events can only come from their trusted main-process owners.
  if(key==='chat')return
  captureActivity(key)
 })
 guardedHandle('usage:activity',(e)=>{
  trusted(e);const now=Date.now();book.prune(now)
  const retained=Math.max(since,now-90*86400000,book.rows.length===50000?Math.min(...book.rows.map(r=>r.startedAt)):0)
  const store=activityStore();store.book.prune(now)
  return {...activitySnapshot(store.book.data,book.rows,retained,now,90,{activity:!store.disabled,token:!disabled}),error:store.error||error}
 })
 guardedHandle('usage:query',(e,raw)=>{trusted(e);book.prune(Date.now());return {...queryLedger({version:1,since,rows:book.rows},validateQuery(raw)),error}})
 guardedHandle('usage:receipt',async(e,mode:unknown,data:unknown)=>{
  trusted(e)
  if((mode!=='copy'&&mode!=='save')||typeof data!=='string'||data.length>5_000_000||!data.startsWith('data:image/png;base64,'))throw new Error(tm('errCore.usage.badReceipt'))
  const bytes=Buffer.from(data.slice('data:image/png;base64,'.length),'base64')
  // Bound dimensions before native decoding, not only after allocation.
  if(bytes.length<33||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||bytes.toString('ascii',12,16)!=='IHDR'||bytes.readUInt32BE(16)!==880||![1600,1920].includes(bytes.readUInt32BE(20)))throw new Error(tm('errCore.usage.badReceiptSize'))
  const image=nativeImage.createFromDataURL(data)
  const size=image.getSize()
  if(image.isEmpty()||size.width!==880||![1600,1920].includes(size.height))throw new Error(tm('errCore.usage.badReceiptSize'))
  if(mode==='copy'){clipboard.writeImage(image);return {ok:true}}
  const result=await dialog.showSaveDialog(BrowserWindow.fromWebContents(e.sender)!,{title:t('dialogs.usage.saveReceipt'),defaultPath:'eas-usage-receipt.png',filters:[{name:'PNG',extensions:['png']}]})
  if(result.canceled||!result.filePath)return {ok:false,cancelled:true}
  const g=guardPath(result.filePath);if(!g.ok)return g
  await fs.promises.writeFile(g.path,image.toPNG())
  return {ok:true,path:g.path}
 })
 guardedHandle('usage:stage',async(e,id:unknown,stage:unknown)=>{
  trusted(e)
  if(disabled)throw new Error(error)
  if(typeof id!=='string'||typeof stage!=='string'||stage.length>60||/[\x00-\x1f]/.test(stage))throw new Error(tm('errCore.usage.stageName'))
  const row=book.rows.find(r=>r.id===id);if(!row)throw new Error(tm('errCore.usage.rowGone'))
  row.stage=stage.trim()||undefined;await flush();if(error)throw new Error(error)
 })
 guardedHandle('usage:export',async(e,raw)=>{
  trusted(e);const q=validateQuery(raw)
  const result=await dialog.showSaveDialog(BrowserWindow.fromWebContents(e.sender)!,{title:t('dialogs.usage.exportCsv'),defaultPath:q.project?path.join(q.project,'usage.csv'):'usage.csv',filters:[{name:'CSV',extensions:['csv']}]})
  if(result.canceled||!result.filePath)return {ok:false,cancelled:true}
  const g=guardPath(result.filePath);if(!g.ok)return g
  await fs.promises.writeFile(g.path,csvOf(book.rows.filter(r=>r.startedAt>=q.from&&r.startedAt<q.to&&(!q.project||r.project===q.project))),'utf8')
  return {ok:true,path:g.path}
 })
 let quitFlushed=false
 app.on('will-quit',(event)=>{
  if(quitFlushed)return
  event.preventDefault()
  if(timer){clearTimeout(timer);timer=undefined}
  void Promise.all([flush(),flushActivity()]).finally(()=>{quitFlushed=true;app.quit()})
 })
}
