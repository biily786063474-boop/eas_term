import { tm } from '../../shared/i18n/current.ts'
export interface StopResult {ok:boolean;reason?:string}
/** Main-process gate: renderer retries must never stack native confirmation dialogs. */
export function createStopGate(){
 const pending=new Set<string>()
 return async (id:string,run:()=>Promise<StopResult>):Promise<StopResult>=>{
  if(pending.has(id))return {ok:false,reason:tm('errCore.rt.confirmPending')}
  pending.add(id)
  try{return await run()}finally{pending.delete(id)}
 }
}
