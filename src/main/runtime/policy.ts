export type AdmissionReason = 'ready' | 'metrics-unavailable' | 'metrics-stale' | 'critical-pressure' | 'recovering' | 'cpu-threshold' | 'memory-threshold'
export interface AdmissionDecision {allowed:boolean;reason:AdmissionReason}
export type ResourceMode = 'normal' | 'eco'
export interface PressureSample { at: number; cpu: number | null; memory: number | null; critical: boolean }
export interface ResourceCost { cpu: number; memory: number }
const valid = (n: number | null): n is number => n !== null && Number.isFinite(n) && n >= 0 && n <= 100
/** Pure admission policy, not an OS hard limit. No killing, timers or shell.
 * Critical control-plane operations must never acquire this heavy-work gate.
 * Memory must already be normalized by a validated platform adapter.
 */
export function createResourcePolicy(initial: ResourceMode = 'normal') {
 let mode = initial
 let latest: PressureSample | null = null
 let highCount = 0, congested = false, recoverySince: number | null = null
 const threshold = () => mode === 'eco' ? 50 : 80
 const decision=(now:number,reserved:ResourceCost={cpu:0,memory:0}):AdmissionDecision=>{
  let reason:AdmissionReason='ready'
  if(!latest||!Number.isFinite(now)||!valid(latest.cpu)||!valid(latest.memory)||!valid(reserved.cpu)||!valid(reserved.memory))reason='metrics-unavailable'
  else if(now<latest.at||now-latest.at>5000)reason='metrics-stale'
  else if(latest.critical)reason='critical-pressure'
  else if(latest.cpu+reserved.cpu>=threshold())reason='cpu-threshold'
  else if(latest.memory+reserved.memory>=threshold())reason='memory-threshold'
  else if(congested)reason='recovering'
  return {allowed:reason==='ready',reason}
 }
 return {
  setMode(next: ResourceMode): void {
   if (next === mode) return
   mode = next; highCount = 0; recoverySince = null
   // Existing congestion is not cleared by changing mode.
  },
  update(input: PressureSample): void {
   if (!Number.isFinite(input.at) || (latest && input.at <= latest.at)) return
   const gap = latest ? input.at - latest.at : 0
   latest = { ...input }
   if (gap > 5000) { recoverySince = null; highCount = 0 }
   if (input.critical) { congested = true; recoverySince = null; return }
   if (!valid(input.cpu) || !valid(input.memory)) { highCount = 0; recoverySince = null; return }
   const high = input.cpu >= threshold() || input.memory >= threshold()
   highCount = high ? highCount + 1 : 0
   if (highCount >= 3) congested = true
   if (congested && input.cpu < threshold() - 10 && input.memory < threshold() - 10) {
    recoverySince ??= input.at
    if (input.at - recoverySince >= 10000) { congested = false; recoverySince = null }
   } else recoverySince = null
  },
  decision,
  allow(now: number, reserved: ResourceCost = { cpu: 0, memory: 0 }): boolean {
   return decision(now,reserved).allowed
  }
 }
}
