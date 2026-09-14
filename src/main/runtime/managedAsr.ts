import {startManagedSession,cancelSessionStartsForWindow} from './sessionStartup.ts'
import {sharedServices} from './sharedServices.ts'
interface AsrWindow {
 id:number;isDestroyed():boolean
 on(event:'did-navigate'|'render-process-gone',listener:()=>void):unknown
 once(event:'destroyed',listener:()=>void):unknown
}
interface AsrHandle<T> {value:T;ready:Promise<void>;completed:Promise<void>;stop():void}
let sequence=0
/** One shared resident model, admitted before allocation and independently of decode slots. */
export function createManagedAsr<T>(open:()=>AsrHandle<T>|null){
 type Entry={id:string;windows:Set<number>;promise:Promise<T|null>;handle?:AsrHandle<T>;stopping:boolean}
 let current:Entry|undefined
 const epochs=new WeakMap<AsrWindow,number>()
 const invalidate=(entry:Entry)=>{if(current===entry)current=undefined}
 const stop=(entry:Entry)=>{
  if(entry.stopping)return
  entry.stopping=true;invalidate(entry)
  entry.handle?.stop()
 }
 return {async get(owner:AsrWindow):Promise<T|null>{
  if(owner.isDestroyed())throw Error('cancelled')
  if(!epochs.has(owner)){
   epochs.set(owner,0)
   const release=()=>{
    epochs.set(owner,epochs.get(owner)!+1)
    cancelSessionStartsForWindow(owner.id)
    const entry=current
    if(entry){entry.windows.delete(owner.id);if(!entry.windows.size)stop(entry)}
    sharedServices.releaseWindow(owner.id)
   }
   owner.on('did-navigate',release);owner.on('render-process-gone',release);owner.once('destroyed',release)
  }
  const epoch=epochs.get(owner)
  let entry=current
  if(!entry){
   entry={id:`voice-asr:${++sequence}`,windows:new Set([owner.id]),promise:Promise.resolve(null),stopping:false}
   current=entry
   const owned=entry
   owned.promise=startManagedSession({id:owned.id,windowId:owner.id,sharedWindows:owned.windows,
    name:'语音识别模型',projectId:null,cost:{cpu:10,memoryBytes:512*1024**2},
    start:async signal=>{
     if(signal.aborted||owned.stopping)throw Error('cancelled')
     const handle=open()
     if(!handle){invalidate(owned);return {value:null,completed:Promise.resolve()}}
     owned.handle=handle
     void handle.completed.then(()=>invalidate(owned))
     try{
      await handle.ready
      if(signal.aborted||owned.stopping||!owned.windows.size)throw Error('cancelled')
     }catch(error){stop(owned);await handle.completed;throw error}
     sharedServices.add({id:owned.id,name:'语音识别 ASR 模型',kind:'voice',completed:handle.completed,stop:()=>stop(owned)})
     for(const id of owned.windows)sharedServices.retain(owned.id,id,null)
     return {value:handle.value,completed:handle.completed}
    }
   }).catch(error=>{invalidate(owned);throw error})
  }else{
   entry.windows.add(owner.id)
   sharedServices.retain(entry.id,owner.id,null)
  }
  const result=await entry.promise
  if(owner.isDestroyed()||epochs.get(owner)!==epoch)throw Error('cancelled')
  return result
 }}
}
