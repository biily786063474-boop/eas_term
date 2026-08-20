// 画布存档要不要在覆盖前先留一份。
//
// 2026-08-20 的教训：一个 React 报错弹出 ErrorBoundary，上面摆着「重置画布并重载」——
// 人在界面崩了的时候最容易点它，而它 `canvas.save(EMPTY_CANVAS)` 一下去，
// **25KB 的布局（20 个 Frame）当场变成 2KB（3 个），没有任何备份、不可逆**。
// 用户丢了所有 Frame 里的节点摆放。项目列表还在，但每个工作区长什么样全没了。
//
// 所以判据不是「是不是手动重置」，而是**这次写入是不是让内容大幅缩水**。
// 那能一并挡住别的意外清空路径（坏存档触发的重建、某个 bug 把 frames 清成空数组…），
// 不用一条条去堵。
//
// **宁可多备份。** 误判的代价是磁盘上多一个几十 KB 的文件；
// 判漏的代价是用户永久丢掉自己的工作区布局，两者差得太远。
//
// 纯函数、不引 electron/fs，node --test 直接跑。

/** 留几份。太多会在 userData 里堆成垃圾，太少挡不住「连续点两次重置」。 */
export const KEEP_BACKUPS = 5

/**
 * @param prevFrames 盘上那份有几个 Frame（读不到就传 0）
 * @param nextFrames 这次要写的有几个
 */
export function shouldBackup(prevFrames: number, nextFrames: number): boolean {
  if (prevFrames <= 0) return false // 本来就是空的，没什么可备份
  if (nextFrames === 0) return true // 清空 —— 最典型的那一下
  return nextFrames * 2 <= prevFrames // 掉了一半以上
}

/** 备份文件名。带毫秒时间戳，保证连点两次也不互相覆盖。 */
export function backupName(base: string, now: number): string {
  const d = new Date(now)
  const p = (n: number, w = 2): string => String(n).padStart(w, '0')
  return `${base}.bak-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${p(d.getMilliseconds(), 3)}`
}

/** 从一堆备份文件名里挑出该删的（只留最近 KEEP_BACKUPS 份）。
 *  **按名字排序就是按时间排序** —— 名字里的时间戳是零填充的定长格式。 */
export function prunable(names: readonly string[]): string[] {
  const baks = names.filter((n) => n.includes('.bak-')).sort()
  return baks.slice(0, Math.max(0, baks.length - KEEP_BACKUPS))
}
