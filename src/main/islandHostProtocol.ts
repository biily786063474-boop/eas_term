import type {IslandAction, IslandState} from '../shared/types.ts'
export const HOST_FRAME_LIMIT = 256 * 1024
export type HostEvent = {v:1;generation:string} & (
 | {type:'ready'} | {type:'resize';w:number;h:number} | {type:'hold';value:boolean}
 | {type:'action';action:IslandAction})
const record=(v:unknown):v is Record<string,unknown>=>!!v && typeof v==='object' && !Array.isArray(v)
export function decodeHostEvent(line:string,generation:string):HostEvent|null {
 if(Buffer.byteLength(line)>HOST_FRAME_LIMIT)return null
 let m:unknown;try{m=JSON.parse(line)}catch{return null}
 if(!record(m)||m.v!==1||m.generation!==generation)return null
 const base={v:1 as const,generation}
 if(m.type==='ready')return {...base,type:'ready'}
 if(m.type==='hold'&&typeof m.value==='boolean')return {...base,type:'hold',value:m.value}
 if(m.type==='resize'&&typeof m.w==='number'&&typeof m.h==='number'&&Number.isFinite(m.w)&&Number.isFinite(m.h)&&m.w>=18&&m.w<=760&&m.h>=16&&m.h<=420)return {...base,type:'resize',w:m.w,h:m.h}
 if(m.type==='action'&&record(m.action)){
  const a=m.action
  if(!['focus','dismiss','approve','mini','unmini'].includes(String(a.type))||typeof a.key!=='string'||a.key.length>1024)return null
  if(a.type==='approve'&&(!Number.isSafeInteger(a.choice)||Number(a.choice)<0))return null
  return {...base,type:'action',action:{type:a.type as IslandAction['type'],key:a.key,...(a.type==='approve'?{choice:a.choice as number}:{})}}
 }
 return null
}
export function allowHostAction(a:IslandAction,state:IslandState):boolean {
 if(a.type==='mini'||a.type==='unmini')return a.key===''
 if(a.type==='dismiss')return state.notices.some(n=>n.id===a.key)
 if(a.type==='focus')return state.running.some(n=>n.key===a.key)||state.notices.some(n=>n.id.split(':')[0]===a.key)
 // Lab gate: terminal approvals lack a stable request revision. Never approve a replacement prompt.
 if(a.type==='approve')return false
 return false
}
/** Byte buffering avoids UTF-8 corruption and enforces a cap before JSON parse. */
export class HostLineDecoder {
 private pending=Buffer.alloc(0)
 private readonly emit:(line:string)=>void
 private readonly limit:number
 constructor(emit:(line:string)=>void,limit=HOST_FRAME_LIMIT){this.emit=emit;this.limit=limit}
 push(chunk:Buffer):void {
  let start=0
  while(start<chunk.length){
   const end=chunk.indexOf(10,start),stop=end<0?chunk.length:end
   if(this.pending.length+stop-start>this.limit)throw Error('host frame limit')
   this.pending=Buffer.concat([this.pending,chunk.subarray(start,stop)])
   if(end<0)return
   const line=this.pending.toString('utf8');this.pending=Buffer.alloc(0);this.emit(line);start=end+1
  }
 }
 end():void{if(this.pending.length)throw Error('partial host frame at EOF')}
}
/** Presentation-only copy: oversized approvals become a safe jump-back notice, never a partial command. */
export function hostPresentation(state:IslandState):IslandState {
 const cut=(s:string|undefined,n=1024)=>s?.slice(0,n)
 const result:IslandState={foreground:state.foreground,mini:state.mini,notch:state.notch,
  running:state.running.slice(0,64).map(n=>({key:n.key,project:cut(n.project,256)??'',term:cut(n.term,256)??'',startedAt:n.startedAt})),
  notices:state.notices.slice(0,32).map(n=>({id:n.id,kind:n.kind,project:cut(n.project,256)??'',term:cut(n.term,256)??'',at:n.at,
   nativeApprovalUnavailable:n.kind==='approval',paneKind:n.paneKind,ask:cut(n.ask),answer:cut(n.answer,2048),roundMs:n.roundMs,totalMs:n.totalMs,model:cut(n.model,128),effort:cut(n.effort,128),agent:n.agent,
   ...(Buffer.byteLength(n.body??'')>8192 ? {question:'审批内容过长，请回到终端查看完整内容',dangerous:true,options:[]} :
    {question:cut(n.question),body:n.body,dangerous:n.dangerous,stale:n.stale,options:[]})
  }))}
 while(Buffer.byteLength(JSON.stringify(result))>240000 && result.notices.length>1)result.notices.pop()
 while(Buffer.byteLength(JSON.stringify(result))>240000 && result.running.length>1)result.running.pop()
 return result
}
