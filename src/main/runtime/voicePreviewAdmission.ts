import {ownedSessions} from './ownedSessions.ts'
import {cancelSessionStart,startManagedSession} from './sessionStartup.ts'
interface PreviewOwner {id:number;isDestroyed():boolean;on(event:'did-navigate'|'render-process-gone',listener:()=>void):unknown;once(event:'destroyed',listener:()=>void):unknown;removeListener(event:'did-navigate'|'render-process-gone'|'destroyed',listener:()=>void):unknown}
let sequence=0
interface PreviewSession {
 ready:Promise<void>;completed:Promise<void>
 stop():void
 push(samples:Float32Array,targetId:string):boolean
 takeText():Promise<string>
}
/** Per-recording worker reservation includes ongoing decode; audio is bounded, never queued as long-running tasks. */
export async function openManagedPreview(owner:PreviewOwner,signal:AbortSignal,create:()=>PreviewSession,onStopped:(message:string)=>void):Promise<PreviewSession>{
 if(owner.isDestroyed()||signal.aborted)throw Error('cancelled')
 const id=`voice-preview:${owner.id}:${++sequence}`
 let session:PreviewSession|undefined,stopped=false
 const stop=()=>{if(stopped)return;stopped=true;session?.stop()}
 const release=()=>{cancelSessionStart(id,owner.id);stop()}
 const detach=()=>{
  signal.removeEventListener('abort',release)
  owner.removeListener('did-navigate',release);owner.removeListener('render-process-gone',release);owner.removeListener('destroyed',release)
 }
 owner.on('did-navigate',release);owner.on('render-process-gone',release);owner.once('destroyed',release)
 signal.addEventListener('abort',release,{once:true})
 try{
  return await startManagedSession({id,windowId:owner.id,name:'流式语音模型加载',interactive:true,projectId:null,
   cost:{cpu:10,memoryBytes:512*1024**2},start:async admitted=>{
    if(admitted.aborted||signal.aborted||owner.isDestroyed()||stopped)throw Error('cancelled')
    session=create()
    admitted.addEventListener('abort',stop,{once:true})
    void session.completed.then(()=>{detach();admitted.removeEventListener('abort',stop)})
    try{
     await session.ready
     if(admitted.aborted||signal.aborted||owner.isDestroyed()||stopped)throw Error('cancelled')
    }catch(error){stop();await session.completed;throw error}
    const result={...session,stop}
    ownedSessions.add({id,name:'流式语音识别',kind:'voice',windowId:owner.id,projectId:null,
     completed:session.completed,stop:()=>{if(stopped)return;stop();onStopped('流式识别服务已关闭，录音已停止')}})
    return {value:result,completed:session.completed}
   }
  })
 }catch(error){detach();throw error}
}
