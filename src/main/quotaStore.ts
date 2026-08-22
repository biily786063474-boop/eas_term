// 额度用量的采集与落盘。两个 CLI 两条路，汇到同一份快照里广播给渲染层。
//
// 取数细节见 shared/quota.ts 的文件头。这里只管「什么时候采、存哪、怎么发」。

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { app, ipcMain, BrowserWindow } from 'electron'
import {
  codexQuotaFromLine,
  claudeQuotaFromStatusline,
  claudeQuotaWindowFromEvent,
  shouldReplaceWindow,
  type QuotaSnapshot,
  type CliQuota,
  type QuotaWindow
} from '../shared/quota.ts'

/** 落盘位置。**要落盘**（用户 2026-08-21 拍板）：两边都是「跑过一轮才有数」，
 *  不落的话每天第一次打开软件那个常驻 bar 都是空的，等于没有。 */
function storeFile(): string {
  return path.join(app.getPath('userData'), 'quota.json')
}

let snapshot: QuotaSnapshot = {}

function load(): void {
  try {
    const raw = JSON.parse(fs.readFileSync(storeFile(), 'utf8')) as QuotaSnapshot
    if (raw && typeof raw === 'object') snapshot = raw
  } catch {
    /* 没有就是没有 —— 第一次跑、或者文件坏了，都当空的重来 */
  }
}

function save(): void {
  try {
    fs.writeFileSync(storeFile(), JSON.stringify(snapshot), 'utf8')
  } catch (e) {
    console.error('[quota] 落盘失败', e)
  }
}

function broadcast(): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('quota:data', snapshot)
  }
}

function merge(cli: 'claude' | 'codex', q: CliQuota | null): void {
  if (!q) return
  const prev = snapshot[cli]
  // 同一个时刻的重复数据不重复广播 —— statusline 每隔几秒就回传一次
  if (
    prev &&
    prev.primary?.percent === q.primary?.percent &&
    prev.secondary?.percent === q.secondary?.percent
  ) {
    return
  }
  snapshot = { ...snapshot, [cli]: q }
  save()
  broadcast()
}

/** Claude 侧：statusline 转发脚本回传的那份 JSON。
 *
 *  **五小时和七天两个窗口都在这里**，headless 事件流里没有（见 shared/quota.ts）。
 *  它的 used_percentage 已经是 0–100，不用换算。 */
/** 一格数据「旧到没有参考意义」的门槛。超过它，事件流那条只在跨阈值时才报的补充值
 *  才允许盖掉 statusline 留下的旧值——否则宁可继续显示旧的精确值。 */
const STALE_MS = 10 * 60_000

/** **按窗口写入的唯一入口**。Claude 的两条来源都走它。返回「有没有真的改动」。
 *
 *  为什么必须收口（2026-08-22 对抗性审查揪出的两个真 bug）：
 *
 *  · **statusline 那条原来走整体替换**，而它的 payload 是**条件展开**的——
 *    Claude Code 2.1.240 的二进制里带着官方注释
 *    `Optional: 5-hour session limit (may be absent)`，转发脚本又是原样透传。
 *    只带一个窗口时，整体替换会把另一格连同 resetsAt 一起抹掉**并落盘**，
 *    重开软件也回不来——正是本文件注释里说要防的「比不更新更让人困惑」，方向反了。
 *
 *  · **两条来源对同一格给出的数字差 1**（statusline 报 79，事件流 0.796×100 四舍五入成 80），
 *    而原来两处去重都只比 percent、从不比时间戳，于是谁后到谁说了算，79/80 无限横跳。
 *    80 正好是 QuotaBar 的告警阈值，颜色也跟着红/不红地闪。 */
function putWindow(slot: 'primary' | 'secondary', w: QuotaWindow): boolean {
  const prev = snapshot.claude
  const old = prev?.[slot]
  if (!shouldReplaceWindow(old, w, STALE_MS)) return false
  // 同一条数据重复到达（statusline 每隔几秒就回传一次）不值得落盘 + 广播
  if (old && old.percent === w.percent && old.resetsAt === w.resetsAt && old.src === w.src) return false
  snapshot = {
    ...snapshot,
    claude: {
      ...(prev ?? { updatedAt: 0 }),
      [slot]: w,
      // 保留 CLI 级时间戳只为兼容落盘格式；**显示新鲜度请用每格自己的 at**
      updatedAt: Math.max(prev?.updatedAt ?? 0, w.at)
    }
  }
  return true
}

/** Claude 侧：statusline 转发脚本回传的那份 JSON。
 *
 *  **五小时和七天两个窗口都在这里**（但都可能缺席，见 putWindow 的注释），
 *  headless 事件流里没有（见 shared/quota.ts）。
 *  它的 used_percentage 已经是 0–100，不用换算。 */
export function ingestStatusline(data: unknown): void {
  const q = claudeQuotaFromStatusline(data, Date.now())
  if (!q) return
  // **只写它这次真的带来的窗口**，缺席的那一格保持原样
  let changed = false
  if (q.primary) changed = putWindow('primary', q.primary) || changed
  if (q.secondary) changed = putWindow('secondary', q.secondary) || changed
  if (changed) {
    save()
    broadcast()
  }
}

/** AI 对话（headless）那条通道来的额度：**只更新它报到的那一个窗口**。
 *
 *  为什么存在：AI 对话跑的是 `claude -p`，没有状态栏，statusline 那条路整个不存在。
 *  **只用 AI 对话、从不开终端的用户，全靠这一条**（用户 2026-08-22 提出）。
 *
 *  为什么不能走 merge()：那是整体替换，而 rate_limit_event 一次只报一个窗口，
 *  平时还只报超过阈值的那个。整体替换会把 statusline 攒下的另一个窗口抹掉，
 *  表现成「五小时那个数时有时无」——比不更新更让人困惑。 */
export function ingestChatQuota(e: {
  window: string
  utilization?: number
  resetsAt?: number
}): void {
  const hit = claudeQuotaWindowFromEvent(e.window, e.utilization, e.resetsAt, Date.now())
  if (!hit) return
  if (putWindow(hit.slot, hit.w)) {
    save()
    broadcast()
  }
}

/** Codex 侧：读它自己最新那份会话日志。
 *
 *  headless 流里没有额度（2026-08-21 实测），只能来这儿捞。
 *  **额度是账号级的**，所以不必关心是哪个会话 —— 取最近改过的那个文件，
 *  从**尾部往前**找第一条带 rate_limits 的行（最新的那条才是当前用量）。
 *
 *  只读 8KB 尾巴：rollout 日志可能几十兆，为一个百分比整份读进来不值当。 */
function readCodexQuota(): CliQuota | null {
  try {
    const root = path.join(os.homedir(), '.codex', 'sessions')
    let newest: { file: string; mtime: number } | null = null
    // 目录结构是 <年>/<月>/<日>/rollout-*.jsonl，深度固定，不做无界递归
    for (const y of fs.readdirSync(root)) {
      for (const m of fs.readdirSync(path.join(root, y))) {
        for (const d of fs.readdirSync(path.join(root, y, m))) {
          const dir = path.join(root, y, m, d)
          for (const f of fs.readdirSync(dir)) {
            if (!f.endsWith('.jsonl')) continue
            const full = path.join(dir, f)
            const mt = fs.statSync(full).mtimeMs
            if (!newest || mt > newest.mtime) newest = { file: full, mtime: mt }
          }
        }
      }
    }
    if (!newest) return null
    const size = fs.statSync(newest.file).size
    const start = Math.max(0, size - 8192)
    const fd = fs.openSync(newest.file, 'r')
    const buf = Buffer.alloc(size - start)
    fs.readSync(fd, buf, 0, buf.length, start)
    fs.closeSync(fd)
    const lines = buf.toString('utf8').split('\n')
    const now = Date.now()
    // 从后往前 —— 最新那条才是当前用量
    for (let i = lines.length - 1; i >= 0; i--) {
      const q = codexQuotaFromLine(lines[i], now)
      if (q) return q
    }
    return null
  } catch {
    return null // 没装 codex、没跑过、格式变了 —— 一律当没有
  }
}

/** 多久扫一次 Codex 日志。额度是分钟级变化的东西，30 秒足够；
 *  而且只读 8KB 尾巴，代价很小。 */
const CODEX_POLL_MS = 30_000

export function registerQuotaHandlers(): void {
  load()
  ipcMain.handle('quota:get', (): QuotaSnapshot => snapshot)
  const tick = (): void => merge('codex', readCodexQuota())
  tick()
  // 轮询留着当兜底：fs.watch 在某些文件系统上会漏事件，
  // macOS 的 recursive 监听对「监听之后才创建的深层目录」也不总是可靠。
  setInterval(tick, CODEX_POLL_MS)
  watchCodex(tick)
}

/** 盯住 Codex 的会话日志目录 —— 它一写盘就重读。
 *
 *  「CLI 刚答完就该更新」靠的是这条：光轮询的话，一轮对话结束后最坏要干等
 *  30 秒额度才动，看着就像没反应。**额度是账号级的**，所以不必关心是哪个会话
 *  在写、更不必逐个窗口去挂监听 —— 任何一个窗口里的 codex 写了日志，
 *  这里都会收到。 */
function watchCodex(tick: () => void): void {
  const dir = path.join(os.homedir(), '.codex', 'sessions')
  try {
    let t: NodeJS.Timeout | null = null
    fs.watch(dir, { recursive: true }, () => {
      // 防抖：一轮对话会连着写好几行，300ms 内的抖动合成一次读
      if (t) clearTimeout(t)
      t = setTimeout(tick, 300)
    })
  } catch {
    /* 没装 codex、目录还不存在 —— 轮询照旧兜着，不值得报错 */
  }
}
