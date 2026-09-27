/** Decision only. This module never reloads a window or terminates a process.
 * knownIdle must come from authoritative task + persistence owners, not UI busy.
 * generation must change on every activity, including work completed between polls.
 */
export interface IdleRecoveryObservation {
 at:number
 background:boolean
 knownIdle:boolean
 enabled:boolean
 generation:number
}
export function createIdleRecoveryPolicy({idleMs=3_600_000,maxSampleGapMs=90_000}={}) {
 let since:number|null=null
 let previous:number|null=null
 let generation:number|undefined
 let emitted=false
 return {
  observe(s:IdleRecoveryObservation):boolean {
   const valid=Number.isFinite(s.at)&&s.at>=0&&Number.isSafeInteger(s.generation)&&s.generation>=0
   const continuity=valid&&previous!==null&&s.at>=previous&&s.at-previous<=maxSampleGapMs&&generation===s.generation
   const eligible=valid&&s.enabled===true&&s.background===true&&s.knownIdle===true
   if(!eligible||!continuity||since===null){since=eligible?s.at:null;emitted=false}
   previous=valid?s.at:null
   generation=s.generation
   if(!eligible||since===null||emitted||s.at-since<idleMs)return false
   emitted=true
   return true
  },
  reset():void {since=null;previous=null;generation=undefined;emitted=false}
 }
}
