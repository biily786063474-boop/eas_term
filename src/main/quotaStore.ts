// 额度用量的采集与落盘。两个 CLI 两条路，汇到同一份快照里广播给渲染层。
//
// 取数细节见 shared/quota.ts 的文件头。这里只管「什么时候采、存哪、怎么发」。

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { app, ipcMain, BrowserWindow } from 'electron'
import { codexQuotaFromLine, clampPercent, type QuotaSnapshot, type CliQuota } from '../shared/quota.ts'

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
export function ingestStatusline(data: unknown): void {
  const rec = (v: unknown): Record<string, unknown> | undefined =>
    v && typeof v === 'object' ? (v as Record<string, unknown>) : undefined
  const rl = rec(rec(data)?.rate_limits)
  if (!rl) return
  const win = (v: unknown, minutes: number): CliQuota['primary'] => {
    const w = rec(v)
    const percent = clampPercent(w?.used_percentage)
    if (percent === undefined) return undefined
    return {
      percent,
      windowMinutes: minutes,
      resetsAt: typeof w?.resets_at === 'number' ? w.resets_at : undefined
    }
  }
  const primary = win(rl.five_hour, 300)
  const secondary = win(rl.seven_day, 10080)
  if (!primary && !secondary) return
  merge('claude', { primary, secondary, updatedAt: Date.now() })
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
  setInterval(tick, CODEX_POLL_MS)
}
