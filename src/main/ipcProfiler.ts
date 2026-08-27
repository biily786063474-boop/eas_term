// IPC 耗时埋点：把「哪个 handler 卡住了主进程」变成事实，而不是猜。
//
// 为什么需要：用户报 Windows 上「点击打开网址」「关终端」会未响应，
// 而同一份代码在 macOS 上实测全都是毫秒级（probePaths 0.1ms、切视图 1ms）。
// 平台差异查不出来 —— Windows 的文件 I/O 更慢、杀毒软件实时扫描会把每次
// statSync 拖到几十毫秒、起外部进程的开销也大一个量级。
//
// **主进程的 ipcMain.handle 是同步执行的**：一个 handler 卡 300ms，
// 这 300ms 内所有窗口的所有 IPC 全部排队，表现就是整个界面冻住。
// 所以只要记下「每个 handler 花了多久」，就能直接指认是哪一个。
//
// 开销：一次 Date.now() + 一个比较。慢调用才写文件，正常调用零 I/O。
import { app, ipcMain } from 'electron'
import fs from 'fs'
import path from 'path'

/** 超过这个毫秒数才记 —— 正常调用都在 1ms 上下，100ms 已经是肉眼可感的卡顿 */
const SLOW_MS = 100
/** 日志封顶，防止长跑把磁盘写满 */
const CAP = 512_000

let enabled = false
let logPath = ''
/** 每个 channel 的累计统计，退出时汇总一次 —— 单看慢调用会漏掉「每次 30ms 但一秒十次」那种 */
const stats = new Map<string, { n: number; total: number; max: number }>()

function write(line: string): void {
  try {
    if (fs.existsSync(logPath) && fs.statSync(logPath).size > CAP) fs.writeFileSync(logPath, '')
    fs.appendFileSync(logPath, line + '\n')
  } catch {
    /* 日志写不进去不该影响主流程 */
  }
}

/** 包装 ipcMain.handle / ipcMain.on，给每次调用计时。
 *  **必须在所有 registerXxxHandlers() 之前调** —— 它替换的是注册函数本身，
 *  晚了的话先注册的那些不会被包到。 */
export function installIpcProfiler(): void {
  if (enabled) return
  enabled = true
  logPath = path.join(app.getPath('userData'), 'ipc-slow.log')
  write(`\n=== ${new Date().toISOString()} 启动 · 平台 ${process.platform} · 阈值 ${SLOW_MS}ms ===`)

  const record = (ch: string, ms: number): void => {
    const s = stats.get(ch) ?? { n: 0, total: 0, max: 0 }
    s.n++
    s.total += ms
    if (ms > s.max) s.max = ms
    stats.set(ch, s)
    if (ms >= SLOW_MS) write(`${new Date().toISOString()} ${ms}ms ${ch}`)
  }

  const origHandle = ipcMain.handle.bind(ipcMain)
  ipcMain.handle = ((ch: string, fn: (...a: unknown[]) => unknown) =>
    origHandle(ch, async (...args: unknown[]) => {
      const t0 = Date.now()
      try {
        return await (fn as (...a: unknown[]) => unknown)(...args)
      } finally {
        record(ch, Date.now() - t0)
      }
    })) as typeof ipcMain.handle

  const origOn = ipcMain.on.bind(ipcMain)
  ipcMain.on = ((ch: string, fn: (...a: unknown[]) => void) =>
    origOn(ch, (...args: unknown[]) => {
      const t0 = Date.now()
      try {
        ;(fn as (...a: unknown[]) => void)(...args)
      } finally {
        record(ch, Date.now() - t0)
      }
    })) as typeof ipcMain.on
}

/** 退出时把累计统计写一份。**按总耗时排序，不是按单次最慢** ——
 *  「每次 30ms 但被调了一千次」比「一次 500ms」更能解释持续卡顿。 */
export function flushIpcProfile(): void {
  if (!enabled || stats.size === 0) return
  const rows = [...stats.entries()]
    .map(([ch, s]) => ({ ch, ...s, avg: s.total / s.n }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 25)
  write(`--- 累计（按总耗时排序，前 ${rows.length} 名）---`)
  for (const r of rows) {
    write(`  ${String(Math.round(r.total)).padStart(7)}ms 合计  ${String(r.n).padStart(5)} 次  ` +
      `均 ${r.avg.toFixed(1)}ms  峰 ${r.max}ms  ${r.ch}`)
  }
}
