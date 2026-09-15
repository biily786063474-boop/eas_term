import {ownedSessions} from './ownedSessions.ts'
interface PreviewOwner {id:number;isDestroyed():boolean;on(event:'did-navigate'|'render-process-gone',listener:()=>void):unknown;once(event:'destroyed',listener:()=>void):unknown;removeListener(event:'did-navigate'|'render-process-gone'|'destroyed',listener:()=>void):unknown}
let sequence=0
interface PreviewSession {
 ready:Promise<void>;completed:Promise<void>
 stop():void
 push(samples:Float32Array,targetId:string):boolean
 takeText():Promise<string>
}
/** 一次录音一个 lease，登记进托管服务（可见、可从运行与资源页关闭）。
 *
 *  **不走资源准入。** 2026-09-14 之前这里经 startManagedSession 排队并预留预算；用户要「语音输入不要
 *  性能的等待队列」，而实测等待的 3 秒也不在队列里（是模型加载，现由 voicePreviewPool 常驻解决）。
 *  所以：不排队、不占 ledger，只保留所有权与关闭。lease 的 completed 是这次录音结束，不是 worker 退出。 */
export async function openManagedPreview(owner:PreviewOwner,signal:AbortSignal,create:()=>PreviewSession,onStopped:(message:string)=>void):Promise<PreviewSession>{
 if(owner.isDestroyed()||signal.aborted)throw Error('cancelled')
 const id=`voice-preview:${owner.id}:${++sequence}`
 const session=create()
 let stopped=false
 const stop=()=>{if(stopped)return;stopped=true;session.stop()}
 const detach=()=>{
  signal.removeEventListener('abort',stop)
  owner.removeListener('did-navigate',stop);owner.removeListener('render-process-gone',stop);owner.removeListener('destroyed',stop)
 }
 owner.on('did-navigate',stop);owner.on('render-process-gone',stop);owner.once('destroyed',stop)
 signal.addEventListener('abort',stop,{once:true})
 void session.completed.then(detach,detach)
 try{
  await session.ready
  if(signal.aborted||owner.isDestroyed()||stopped)throw Error('cancelled')
 }catch(error){stop();throw error}
 ownedSessions.add({id,name:'流式语音识别',kind:'voice',windowId:owner.id,projectId:null,
  completed:session.completed,stop:()=>{if(stopped)return;stop();onStopped('流式识别服务已关闭，录音已停止')}})
 return {...session,stop}
}
