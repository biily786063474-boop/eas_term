export interface StopResult {ok:boolean;reason?:string}
/** Main-process gate: renderer retries must never stack native confirmation dialogs. */
export function createStopGate(){
 const pending=new Set<string>()
 return async (id:string,run:()=>Promise<StopResult>):Promise<StopResult>=>{
  if(pending.has(id))return {ok:false,reason:'该服务已有关闭确认，请先处理当前弹窗'}
  pending.add(id)
  try{return await run()}finally{pending.delete(id)}
 }
}
