// 甘特图的任务记录。照 board.ts 的范式：主进程管文件、逐条校验、坏数据整条丢。
//
// 为什么保留期在写入时执行而不是定时器：定时器要考虑休眠唤醒、时钟跳变、
// 多窗口重复触发；而写入时清理天然只在有新数据时发生，没有这些问题。
import { app, ipcMain } from 'electron'
import fs from 'fs'
import path from 'path'

import type { GanttTask } from '../shared/types'

const storeFile = (): string => path.join(app.getPath('userData'), 'gantt.json')
const KEEP_MS = 7 * 24 * 60 * 60 * 1000
const MAX_TEXT = 2000

const clip = (s: string): string => (s.length > MAX_TEXT ? s.slice(0, MAX_TEXT) : s)

/** 逐条校验。少一个必填字段就整条丢 —— 半条记录跑进 UI 是最难查的那种问题。 */
function valid(t: unknown): t is GanttTask {
  if (!t || typeof t !== 'object') return false
  const o = t as Record<string, unknown>
  return (
    typeof o.id === 'string' &&
    typeof o.projectId === 'string' &&
    typeof o.ptyId === 'string' &&
    typeof o.leafId === 'string' &&
    typeof o.prompt === 'string' &&
    typeof o.startAt === 'number' &&
    (o.endAt === null || typeof o.endAt === 'number')
  )
}

function load(): GanttTask[] {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(storeFile(), 'utf8'))
    return Array.isArray(raw) ? raw.filter(valid) : []
  } catch {
    return []
  }
}

function save(list: GanttTask[]): void {
  try {
    fs.mkdirSync(path.dirname(storeFile()), { recursive: true })
    fs.writeFileSync(storeFile(), JSON.stringify(list, null, 2))
  } catch (e) {
    console.error('[gantt] 写盘失败', e)
  }
}

/** 保留期在这里执行 */
function prune(list: GanttTask[]): GanttTask[] {
  const cut = Date.now() - KEEP_MS
  return list.filter((t) => t.startAt >= cut)
}

export function registerGanttHandlers(): void {
  ipcMain.handle('gantt:list', () => {
    // 没写完的：endAt 还是 null 的都是上次被强杀留下的（正常退出会走 finish）。
    // 打 aborted 标记、endAt 留 null，让 UI 画成开放条。不编一个结束时间——
    // 编出来的数字会被当成真的。
    return load().map((t) => (t.endAt === null ? { ...t, aborted: true as const } : t))
  })

  ipcMain.handle('gantt:push', (_e, t: GanttTask) => {
    if (!valid(t)) return
    const list = prune(load())
    list.push({ ...t, prompt: clip(t.prompt), follow: t.follow?.map(clip) })
    save(list)
  })

  ipcMain.handle('gantt:finish', (_e, id: string, endAt: number) => {
    const list = load()
    const hit = list.find((t) => t.id === id)
    if (!hit) return
    hit.endAt = endAt
    save(prune(list))
  })

  ipcMain.handle('gantt:follow', (_e, id: string, text: string) => {
    const list = load()
    const hit = list.find((t) => t.id === id)
    if (!hit) return
    hit.follow = [...(hit.follow ?? []), clip(text)]
    save(prune(list))
  })
}
