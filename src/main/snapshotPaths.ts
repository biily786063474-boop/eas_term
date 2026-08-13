// 快照的目录与文件名计算。
//
// **不引 electron、不碰文件系统**：这样能被 node --test 直接加载。
// 当天已有哪些文件由调用方读盘后传进来 —— 纯计算才测得住，
// 而「序号该是几」这种事错了，用户会看到两张同名的图互相覆盖。
import path from 'path'

const p2 = (n: number): string => String(n).padStart(2, '0')

/**
 * 这一张快照该写到哪。
 *
 * 按**天**分文件夹：按小时分会碎成一堆，按月分一个目录几百张。
 * 文件名同时带完整时间戳和当日序号 —— 时间戳保证排序与唯一，
 * 序号让人能说「今天第 3 张」。
 */
export function snapshotTarget(
  projectPath: string,
  now: Date,
  existing: string[]
): { dir: string; file: string } {
  const y = now.getFullYear()
  const mo = p2(now.getMonth() + 1)
  const d = p2(now.getDate())
  const stamp = `${y}${mo}${d}-${p2(now.getHours())}${p2(now.getMinutes())}${p2(now.getSeconds())}`
  const dir = path.join(projectPath, 'screenshot', `${y}-${mo}-${d}`)

  // 解析已有文件的序号，取最大值 +1。这样即使用户手动删除了某张，序号也不会冲突。
  // 如果用户自己拖进来的文件名无法解析（如 图1.png），不会让序号计算崩溃，
  // 也不会被当作"第 0 张"，而是直接忽略 —— 它没有序号，所以不参与序号管理。
  const pngNumbers = existing
    .filter((f) => f.toLowerCase().endsWith('.png'))
    .map((f) => {
      const match = f.match(/-(\d+)\.png$/i)
      return match ? parseInt(match[1], 10) : null
    })
    .filter((n) => n !== null) as number[]

  const maxN = pngNumbers.length > 0 ? Math.max(...pngNumbers) : 0
  const n = maxN + 1

  return { dir, file: path.join(dir, `${stamp}-${n}.png`) }
}
