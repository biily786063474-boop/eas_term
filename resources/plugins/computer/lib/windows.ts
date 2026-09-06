// 窗口列表的**解析与降级**。纯函数，有测试。
//
// 数据来自 `bin/eas-windows`（Swift 通用二进制，见 native/windows.swift）。
// **拿不到窗口列表是常态**（没装 Xcode 命令行工具的机器上助手根本没编出来、
// 或者用户没给屏幕录制权限），所以每一处都要有明确的降级，而不是抛错或静默返回空。

import type { WindowInfo } from './redact.ts'

export interface Win extends WindowInfo {
  id: number
  pid: number
  owner: string
}

export type WindowsResult =
  | { ok: true; windows: Win[] }
  | { ok: false; reason: 'no-helper' | 'bad-output' | 'empty'; error: string }

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

export function parseWindows(raw: string): WindowsResult {
  let j: unknown
  try {
    j = JSON.parse(raw)
  } catch {
    return { ok: false, reason: 'bad-output', error: '窗口助手的输出不是 JSON' }
  }
  if (!Array.isArray(j)) return { ok: false, reason: 'bad-output', error: '窗口助手的输出不是数组' }
  const windows: Win[] = []
  for (const it of j) {
    if (!it || typeof it !== 'object') continue
    const r = it as Record<string, unknown>
    const w = num(r.width)
    const h = num(r.height)
    if (w < 40 || h < 40) continue
    windows.push({
      id: num(r.id),
      pid: num(r.pid),
      owner: str(r.owner),
      title: str(r.title),
      bundleId: str(r.bundleId),
      bounds: { x: num(r.x), y: num(r.y), width: w, height: h }
    })
  }
  if (!windows.length) return { ok: false, reason: 'empty', error: '一个窗口都没看到（可能锁屏了，或者没给屏幕录制权限）' }
  return { ok: true, windows }
}

/** 助手不存在时的说明。**要说清后果和怎么办**（「失败要说人话」）。 */
export const NO_HELPER_MSG =
  '拿不到窗口列表（窗口助手没有编译出来）。因此：只能整屏截图、无法按窗口截、也无法给敏感窗口打码。'

/**
 * 前台窗口 = 列表里的第一个（`CGWindowListOptionOnScreenOnly` 按前后顺序返回）。
 * **跳过我们自己**：默认截图不该截到 Eas-Term 自己的界面，那是用户正在看的东西，
 * 模型要看的是别的窗口（也顺带避免「截到自己的对话再喂回自己」这种回环）。
 */
export function frontWindow(windows: readonly Win[], selfBundleId = 'com.biily.easterm'): Win | null {
  for (const w of windows) {
    if (w.bundleId && w.bundleId.toLowerCase() === selfBundleId.toLowerCase()) continue
    return w
  }
  return null
}

/** 按标题或 bundle id 找一个窗口，给 `screen_shot` 的 windowTitle 参数用。大小写不敏感、子串匹配。 */
export function findWindow(windows: readonly Win[], needle: string): Win | null {
  const q = needle.trim().toLowerCase()
  if (!q) return null
  for (const w of windows) {
    if ((w.title ?? '').toLowerCase().includes(q)) return w
    if ((w.bundleId ?? '').toLowerCase() === q) return w
    if (w.owner.toLowerCase().includes(q)) return w
  }
  return null
}
