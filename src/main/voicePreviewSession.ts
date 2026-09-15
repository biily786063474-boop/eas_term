// 流式预览的主进程侧传输层：**一条 link 对应一个常驻 worker，每次录音开一个 lease。**
//
// 2026-09-14 之前是「一次录音一个 worker」：停止就 terminate，下次再建。实测 74MB int8 zipformer
// 在 WASM onnxruntime 里加载要 2.8 秒，用户每按一次麦克风都等这 3 秒（WASM 实例化只占 47ms）。
// 现在 worker 常驻（由 voicePreviewPool 管闲置释放），录音结束只发一条 reset 让 worker 换一个新 stream（1ms）。
//
// 这里仍然不碰麦克风、不加载模型、不做资源准入；只管有界的消息往返与 lease 之间的隔离：
// 旧 lease 的迟到 partial 不会画到新 lease 的输入框里（按消息 id 归属判断）。
interface PreviewMessage {type?:string;id?:number;text?:string;targetId?:string;error?:string}
interface PreviewWorker {
 on(event:'message',listener:(message:PreviewMessage)=>void):unknown
 on(event:'error',listener:(error:Error)=>void):unknown
 on(event:'exit',listener:(code:number)=>void):unknown
 postMessage(message:unknown,transfer?:ArrayBuffer[]):void
 terminate():Promise<number>
}
export interface PreviewLease {
 ready:Promise<void>
 /** 这次录音结束（stop 或 worker 死亡）。**不是** worker 退出。 */
 completed:Promise<void>
 stop():void
 push(samples:Float32Array,targetId:string):boolean
 takeText():Promise<string>
}
export interface PreviewLink {
 ready:Promise<void>
 /** worker 真实退出 */
 exited:Promise<void>
 readonly alive:boolean
 open(onPartial:(text:string,targetId:string)=>void,onError:(message:string)=>void):PreviewLease
 terminate():void
}
interface LeaseState {onPartial:(text:string,targetId:string)=>void;onError:(message:string)=>void;done:boolean;resolveDone:()=>void}

export function createVoicePreviewLink(worker:PreviewWorker):PreviewLink{
 let dead=false,initialized=false,next=0,samplesPending=0,partialBoundary=0
 let current:LeaseState|null=null
 let resolveReady!:()=>void,rejectReady!:(error:Error)=>void
 const ready=new Promise<void>((resolve,reject)=>{resolveReady=resolve;rejectReady=reject})
 ready.catch(()=>{/* 由各 lease 的 ready 转达 */})
 const audio=new Map<number,{samples:number;targetId:string;lease:LeaseState}>()
 const takes=new Map<number,{lease:LeaseState;resolve:(text:string)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>()
 const startupTimer=setTimeout(()=>die('流式语音模型启动超时'),30000);startupTimer.unref()
 const post=(m:unknown,transfer?:ArrayBuffer[]):boolean=>{try{worker.postMessage(m,transfer);return true}catch(error){die(String(error));return false}}
 /** 结束一个 lease：拒绝它的 take、丢它的音频记账、压住它的迟到 partial、让 worker 换新 stream */
 function endLease(lease:LeaseState,reason:string|null){
  if(lease.done)return
  lease.done=true
  for(const [id,take] of takes){if(take.lease===lease){clearTimeout(take.timer);takes.delete(id);take.reject(Error(reason??'流式语音已停止'))}}
  for(const [id,frame] of audio){if(frame.lease===lease){samplesPending-=frame.samples;audio.delete(id)}}
  partialBoundary=next
  if(current===lease)current=null
  if(!dead&&initialized)post({type:'reset'})
  lease.resolveDone()
  if(reason)lease.onError(reason)
 }
 function die(reason:string){
  if(dead)return
  dead=true;clearTimeout(startupTimer);rejectReady(Error(reason))
  if(current)endLease(current,reason)
  void worker.terminate().catch(()=>{/* 真实退出才算 exited */})
 }
 worker.on('error',error=>die(error.message))
 const exited=new Promise<void>(resolve=>worker.on('exit',code=>{if(!dead)die('流式语音线程退出（'+code+'）');resolve()}))
 worker.on('message',m=>{
  if(dead)return
  if(m.type==='ready'){initialized=true;clearTimeout(startupTimer);resolveReady();return}
  if(m.type==='fatal'){die(m.error||'流式语音处理失败');return}
  if(typeof m.id!=='number')return
  const frame=audio.get(m.id)
  if(m.type==='partial'&&frame&&m.id>partialBoundary&&frame.lease===current&&!frame.lease.done){frame.lease.onPartial(m.text??'',frame.targetId);return}
  if(m.type==='ack'&&frame){samplesPending-=frame.samples;audio.delete(m.id);return}
  const take=takes.get(m.id)
  if(m.type==='result'&&take){clearTimeout(take.timer);takes.delete(m.id);take.resolve(m.text??'')}
 })
 return {
  ready,exited,
  get alive(){return !dead},
  terminate(){die('流式语音已停止')},
  open(onPartial,onError){
   if(current)endLease(current,'流式语音被新的录音接管')
   let resolveDone!:()=>void
   const completed=new Promise<void>(r=>{resolveDone=r})
   const lease:LeaseState={onPartial,onError,done:false,resolveDone}
   if(dead){lease.done=true;resolveDone();return {ready:Promise.reject(Error('流式语音线程已退出')),completed,stop(){},push:()=>false,takeText:()=>Promise.reject(Error('流式语音线程已退出'))}}
   current=lease
   const fail=(reason:string):void=>endLease(lease,reason)
   return {
    ready,completed,
    stop(){endLease(lease,null)},
    push(samples,targetId){
     if(lease.done||dead||!initialized)return false
     if(samples.length<1||samples.length>16384||targetId.length>100){fail('流式音频格式无效');return false}
     if(samplesPending+samples.length>32768||audio.size+takes.size>=64){fail('流式识别跟不上录音，音频积压已停止');return false}
     const id=++next,copy=samples.slice();audio.set(id,{samples:copy.length,targetId,lease});samplesPending+=copy.length
     return post({type:'audio',id,samples:copy,targetId},[copy.buffer as ArrayBuffer])
    },
    takeText(){
     if(lease.done||dead||!initialized)return Promise.reject(Error('流式语音未就绪或已停止'))
     if(audio.size+takes.size>=64){fail('流式识别跟不上录音，音频积压已停止');return Promise.reject(Error('流式音频积压'))}
     const id=++next;partialBoundary=id
     return new Promise<string>((resolve,reject)=>{
      const timer=setTimeout(()=>fail('流式语音收尾超时'),30000);timer.unref()
      takes.set(id,{lease,resolve,reject,timer})
      post({type:'take',id})
     })
    }
   }
  }
 }
}
