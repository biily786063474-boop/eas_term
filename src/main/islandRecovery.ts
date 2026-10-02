/** One main-process wakeup per failure; renderer activity is not a recovery clock. */
export function createIslandRecovery(reconcile:()=>void){
 let timer:ReturnType<typeof setTimeout>|undefined
 return {
  schedule(){
   if(timer)return
   timer=setTimeout(()=>{timer=undefined;reconcile()},3000)
   timer.unref()
  },
  cancel(){clearTimeout(timer);timer=undefined}
 }
}

/**
 * 原生宿主故障计数（纯函数，单测钉着）。两类故障分开数：
 *  · ready 之后崩：可能是偶发，允许连续 5 次（稳定跑过 30s 才清零），之后本次运行退回 Electron 岛；
 *  · 从没 ready 过（8s 超时 / 起不来 / 首帧就坏）：基本是这台机器上起不来，再多试也一样。只再给一次机会
 *    （系统偶尔很卡时 8s 可能不够），第二次还起不来就当场退回。
 * 原先两类混在一起数到 5，起不来的宿主要白等 5×(8s 超时 + 3s 重建) ≈ 55s 才有灵动岛（0.4.122 审查遗留）。
 */
export const NATIVE_MAX_FAILURES = 5
export const NATIVE_MAX_UNREADY_FAILURES = 2
export const NATIVE_HEALTHY_MS = 30_000
export interface NativeFailureCount { failures: number; unready: number }
export function recordNativeFailure(prev: NativeFailureCount, readyAt: number, now: number): { count: NativeFailureCount; fallback: boolean } {
  const base = readyAt && now - readyAt > NATIVE_HEALTHY_MS ? { failures: 0, unready: 0 } : prev
  // 这一实例 ready 过 → 不是「起不来」，起不来的连续计数归零
  const count = { failures: base.failures + 1, unready: readyAt ? 0 : base.unready + 1 }
  return { count, fallback: count.failures >= NATIVE_MAX_FAILURES || count.unready >= NATIVE_MAX_UNREADY_FAILURES }
}
