// 闪烁黑匣子（用户 2026-09-05：「偶尔闪一两次，抓不到瞬间」）。
//
// 抓不到瞬间的问题只能靠**事后读记录**：渲染层把「组件整段卸载/重挂」「超过 100ms 的长任务」
// 发到这里，主进程再加上 GPU / 渲染进程崩溃重启、窗口失去响应这几件系统层的事，
// 一起写进 userData/flicker.log（超 1MB 从头砍一半）。用户说「刚才闪了」，读最近 30 秒的行。
//
// ── 开销纪律 ─────────────────────────────────────────────────────────────
// 没有轮询、没有定时器、没有截图；只有事件发生才写一行。渲染层的观察器只挂在容器的
// **直接子级**上（flickerRecorder.ts），不进终端内部。所以空闲时为零。
import { app, ipcMain, shell, type BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { formatLine, Ring, trimLog, type DiagEvent } from './diagRing.ts'

const MAX_BYTES = 1024 * 1024
const ring = new Ring<string>(300)
/** 渲染层来的事件限速：一秒最多 50 条，超了记一条「丢弃」——防某个 bug 把日志刷爆 */
let windowStart = 0
let windowCount = 0
let dropped = 0

function logPath(): string {
  return path.join(app.getPath('userData'), 'flicker.log')
}

export function diag(src: 'r' | 'm', kind: string, what: string): void {
  const line = formatLine({ t: Date.now(), src, kind, what })
  ring.push(line)
  try {
    const p = logPath()
    fs.appendFileSync(p, line + '\n')
    // 只在追加后偶尔看一眼大小（每 200 条），别每行都 stat
    if (ring.size % 200 === 0) {
      const st = fs.statSync(p)
      if (st.size > MAX_BYTES) fs.writeFileSync(p, trimLog(fs.readFileSync(p, 'utf8'), MAX_BYTES))
    }
  } catch {
    /* 写不了就只留内存里那份 */
  }
}

/** 各进程的 CPU 快照。**只在事件发生时取**（`app.getAppMetrics()` 是同步的、几毫秒），
 *  绝不轮询 —— 承诺过空闲零开销。
 *
 *  2026-09-06 的教训：用户报「疯狂闪烁」，日志里却只有几条 longtask、零 mount/unmount。
 *  外面 `ps` 看到 GPU 助手 145% / 渲染 112% / WindowServer 107%，但那是我用命令行现查的，
 *  **日志里没有留下任何痕迹**，事后完全对不上。所以现在长任务发生时顺带记一次谁在烧。 */
function cpuSnapshot(): string {
  try {
    // ⚠️ `percentCPUUsage` 是**距上次调用以来**的平均值，**第一次调用恒为 0**
    // （2026-09-06 实测：不预热的话每条 longtask 后面都是空的）。所以启动时先调一次预热，
    // 之后每次取到的就是「从上一个事件到现在」这段的平均 —— 连着几条 longtask 时窗口很短、
    // 正是我们要的「此刻谁在烧」；久违的第一条则是一段长平均，也够看出「一直在烧」。
    const rows = app
      .getAppMetrics()
      .map((m) => ({ t: m.type === 'Tab' ? 'renderer' : m.type, cpu: m.cpu?.percentCPUUsage ?? 0 }))
      .filter((r) => r.cpu >= 3)
      .sort((a, b) => b.cpu - a.cpu)
      .slice(0, 4)
      .map((r) => `${r.t} ${r.cpu.toFixed(0)}%`)
    return rows.length ? ` | ${rows.join(' · ')}` : ''
  } catch {
    return ''
  }
}

function fromRenderer(e: Partial<DiagEvent>): void {
  const now = Date.now()
  if (now - windowStart > 1000) {
    if (dropped > 0) diag('m', 'dropped', `上一秒丢弃了 ${dropped} 条渲染层事件`)
    windowStart = now
    windowCount = 0
    dropped = 0
  }
  if (++windowCount > 50) {
    dropped++
    return
  }
  const kind = String(e.kind ?? '?').slice(0, 24)
  // 长任务是「这一刻卡了」的信号，正好把「谁在烧 CPU」一起记下来
  const extra = kind === 'longtask' ? cpuSnapshot() : ''
  diag('r', kind, String(e.what ?? '').slice(0, 300) + extra)
}

function hookWindow(win: BrowserWindow): void {
  const wc = win.webContents
  wc.on('render-process-gone', (_e, d) => diag('m', 'render-gone', `渲染进程没了：${d.reason} exit=${d.exitCode}`))
  wc.on('unresponsive', () => diag('m', 'unresponsive', '窗口失去响应'))
  wc.on('responsive', () => diag('m', 'responsive', '窗口恢复响应'))
}

export function registerDiagHandlers(): void {
  ipcMain.on('diag:event', (_e, ev: Partial<DiagEvent>) => fromRenderer(ev))
  ipcMain.handle('diag:recent', () => ring.items())
  ipcMain.handle('diag:showLog', () => {
    const p = logPath()
    if (!fs.existsSync(p)) fs.writeFileSync(p, '')
    shell.showItemInFolder(p)
    return { ok: true }
  })
  // GPU / 工具进程崩溃重启——「其他软件共同作用」那类闪烁多半只在这里留痕
  app.on('child-process-gone', (_e, d) => diag('m', 'child-gone', `${d.type}${d.name ? ' ' + d.name : ''}：${d.reason} exit=${d.exitCode}`))
  // 窗口的生灭也记一笔：灵动岛历史上有过「自激振荡」（反复创建销毁），
  // 那种情况会把 WindowServer 拖满而看起来就是满屏闪（memory: eas-term-灵动岛窗口坑）
  app.on('browser-window-created', (_e, win) => {
    diag('m', 'win-open', `窗口 #${win.id}${cpuSnapshot()}`)
    win.on('closed', () => diag('m', 'win-close', `窗口 #${win.id}`))
    hookWindow(win)
  })
  cpuSnapshot() // 预热：第一次调用恒为 0，不预热的话后面每次都取不到值
  diag('m', 'start', `app ${app.getVersion()} 启动`)
}
