import { tm } from '../../shared/i18n/current.ts'
interface AsrWorker {
 on(event:'message',listener:(message:{type?:string;err?:string})=>void):unknown
 once(event:'exit',listener:()=>void):unknown
 on(event:'error',listener:(error:Error)=>void):unknown
 removeListener(event:'message',listener:(message:{type?:string;err?:string})=>void):unknown
 terminate():Promise<number>
}
/** Ready acknowledges model allocation; completed is exclusively the real thread exit. */
export function trackAsrWorker<T extends AsrWorker>(worker:T){
 let stopping=false,resolveReady!:()=>void,rejectReady!:(error:Error)=>void
 const ready=new Promise<void>((resolve,reject)=>{resolveReady=resolve;rejectReady=reject})
 const timer=setTimeout(()=>{rejectReady(Error(tm('errCore.rt.asrInitTimeout')));stop()},30000)
 timer.unref()
 const clear=()=>{clearTimeout(timer);worker.removeListener('message',message)}
 const message=(m:{type?:string;err?:string})=>{
  if(m.type==='ready'){clear();resolveReady()}
  else if(m.type==='fatal'){clear();rejectReady(Error(m.err||tm('errCore.rt.asrInitFailed')))}
 }
 function stop(){if(stopping)return;stopping=true;void worker.terminate().catch(()=>{/* Exit remains authoritative. */})}
 worker.on('message',message)
 // Keep an error observer even after ready; EventEmitter errors must never escape.
 worker.on('error',error=>{clear();rejectReady(error)})
 const completed=new Promise<void>(resolve=>worker.once('exit',()=>{
  clear();rejectReady(Error(tm('errCore.rt.asrInitExit')));resolve()
 }))
 return {value:worker,ready,completed,stop}
}
