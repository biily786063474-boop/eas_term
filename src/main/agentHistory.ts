// AI 对话的聊天记录落盘：下次打开这个节点，直接看到上次聊到哪。
//
// **为什么不复用 CLI 自己的 transcript**：Claude Code 确实把完整记录写在
// ~/.claude/projects/<cwd>/<sessionId>.jsonl（session.ts 里有现成的解析器），
// 但那条路只覆盖 Claude —— Codex 的格式与落点都不同，而 agentChat 是 CLI 无关的。
// 这里存的是**归约之后的 ChatView.turns**，两个 CLI 走同一条路，
// 也不会被上游改内部格式弄坏。
//
// 按 **leafId**（画布节点 id）存，不是 sessionId：sessionId 每次 start 都会变
// （`ac-${nextId++}`），而 leafId 随 canvas.json 落盘、跨重启稳定，
// 正好对应用户心里的「这个对话框」。
//
// 裁剪在渲染层做（features/agentChat/history.ts），这里只负责存取与容量。

import { app, ipcMain } from 'electron'
import fs from 'fs'
import path from 'path'
import { safeHistoryKey } from './agentHistoryKey'

/** 最多留多少个节点的记录。超了删最旧的 —— 画布上的对话框会不断新建/关闭，
 *  不设上限的话这个目录只增不减。200 份 × 每份几十 KB，量级可控。 */
const MAX_FILES = 200

const dir = (): string => path.join(app.getPath('userData'), 'agent-history')

function fileOf(leafId: string): string | null {
  const key = safeHistoryKey(leafId)
  return key ? path.join(dir(), `${key}.json`) : null
}

function prune(): void {
  try {
    const d = dir()
    const files = fs
      .readdirSync(d)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        const p = path.join(d, f)
        return { p, m: fs.statSync(p).mtimeMs }
      })
    if (files.length <= MAX_FILES) return
    files.sort((a, b) => a.m - b.m)
    for (const f of files.slice(0, files.length - MAX_FILES)) fs.unlinkSync(f.p)
  } catch {
    /* 清理失败不影响主流程 */
  }
}

export function registerAgentHistory(): void {
  ipcMain.handle('agentHistory:load', (_e, leafId: unknown): unknown[] => {
    const f = typeof leafId === 'string' ? fileOf(leafId) : null
    if (!f) return []
    try {
      const raw = JSON.parse(fs.readFileSync(f, 'utf8')) as { turns?: unknown }
      return Array.isArray(raw.turns) ? raw.turns : []
    } catch {
      // 文件不存在 / 坏了 —— 一律当成「没有历史」。
      // **绝不能因为这个抛错**：那会让对话框整个起不来，而它只是个锦上添花的功能。
      return []
    }
  })

  ipcMain.handle('agentHistory:save', (_e, leafId: unknown, turns: unknown): void => {
    const f = typeof leafId === 'string' ? fileOf(leafId) : null
    if (!f || !Array.isArray(turns)) return
    try {
      fs.mkdirSync(dir(), { recursive: true })
      // 空记录就删文件，别留一堆 {"turns":[]}
      if (turns.length === 0) {
        fs.rmSync(f, { force: true })
        return
      }
      fs.writeFileSync(f, JSON.stringify({ v: 1, savedAt: Date.now(), turns }), { mode: 0o600 })
      prune()
    } catch (e) {
      console.error('[agentHistory] 写入失败', e)
    }
  })

  /** 节点被永久关闭时清掉它的记录。**跟着节点走** ——
   *  节点都没了还留着聊天记录，既占地方又没有任何入口能看到。 */
  ipcMain.handle('agentHistory:forget', (_e, leafId: unknown): void => {
    const f = typeof leafId === 'string' ? fileOf(leafId) : null
    if (f) fs.rmSync(f, { force: true })
  })
}
