interface PreviewMessage {type?:string;id?:number;text?:string;targetId?:string;error?:string}
interface PreviewWorker {
 on(event:'message',listener:(message:PreviewMessage)=>void):unknown
 on(event:'error',listener:(error:Error)=>void):unknown
 on(event:'exit',listener:(code:number)=>void):unknown
 postMessage(message:unknown,transfer?:ArrayBuffer[]):void
 terminate():Promise<number>
}
/** Bounded main-side transport. No microphone, model loading, or resource admission here. */
export function createVoicePreviewSession(worker:PreviewWorker,onPartial:(text:string,targetId:string)=>void,onError:(message:string)=>void){
 let stopped=false,initialized=false,next=0,samplesPending=0,partialBoundary=0
 let resolveReady!:()=>void,rejectReady!:(error:Error)=>void
 const ready=new Promise<void>((resolve,reject)=>{resolveReady=resolve;rejectReady=reject})
 const audio=new Map<number,{samples:number;targetId:string}>()
 const takes=new Map<number,{resolve:(text:string)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>()
 const timer=setTimeout(()=>fail('流式语音模型启动超时'),30000);timer.unref()
 function stop(reason='流式语音已停止'){
  if(stopped)return
  stopped=true;clearTimeout(timer);rejectReady(Error(reason))
  for(const take of takes.values()){clearTimeout(take.timer);take.reject(Error(reason))}
  takes.clear();audio.clear();samplesPending=0
  void worker.terminate().catch(()=>{/* Actual exit, not terminate acknowledgement, ends completed. */})
 }
 function fail(reason:string){if(stopped)return;stop(reason);onError(reason)}
 worker.on('error',error=>fail(error.message))
 const completed=new Promise<void>(resolve=>worker.on('exit',code=>{if(!stopped)fail('流式语音线程退出（'+code+'）');resolve()}))
 worker.on('message',m=>{
  if(stopped)return
  if(m.type==='ready'){initialized=true;clearTimeout(timer);resolveReady();return}
  if(m.type==='fatal'){fail(m.error||'流式语音处理失败');return}
  if(typeof m.id!=='number')return
  const frame=audio.get(m.id)
  if(m.type==='partial'&&frame&&m.id>partialBoundary){onPartial(m.text??'',frame.targetId);return}
  if(m.type==='ack'&&frame){samplesPending-=frame.samples;audio.delete(m.id);return}
  const take=takes.get(m.id)
  if(m.type==='result'&&take){clearTimeout(take.timer);takes.delete(m.id);take.resolve(m.text??'')}
 })
 return {
  ready,completed,stop,
  push(samples:Float32Array,targetId:string):boolean{
   if(stopped||!initialized)return false
   if(samples.length<1||samples.length>16384||targetId.length>100){fail('流式音频格式无效');return false}
   if(samplesPending+samples.length>32768||audio.size+takes.size>=64){fail('流式识别跟不上录音，音频积压已停止');return false}
   const id=++next,copy=samples.slice();audio.set(id,{samples:copy.length,targetId});samplesPending+=copy.length
   try{worker.postMessage({type:'audio',id,samples:copy,targetId},[copy.buffer as ArrayBuffer]);return true}
   catch(error){fail(String(error));return false}
  },
  takeText():Promise<string>{
   if(stopped||!initialized)return Promise.reject(Error('流式语音未就绪或已停止'))
   if(audio.size+takes.size>=64){fail('流式识别跟不上录音，音频积压已停止');return Promise.reject(Error('流式音频积压'))}
   const id=++next;partialBoundary=id
   return new Promise<string>((resolve,reject)=>{
    const timer=setTimeout(()=>fail('流式语音收尾超时'),30000);timer.unref()
    takes.set(id,{resolve,reject,timer})
    try{worker.postMessage({type:'take',id})}catch(error){fail(String(error))}
   })
  }
 }
}
