// 主进程侧的完整归档：保存 = 读旧档 → 按序号并集 → 原子写；读取 = 只回最近 n 条。
// 零 electron；路径由调用方（agentHistory.ts）校验后传入。
import fs from 'node:fs'
import { writeHistorySnapshot } from './agentHistoryStorage.ts'
import { mergeArchiveTurns, assignLegacySeq, tailWindow, HISTORY_WINDOW, type SeqTurn } from '../shared/historyArchive.ts'

interface Meta { cwd: string | null; resumeId: string | null; resumeCli: string | null; moduleId: string | null }
type Raw = { moduleId?: unknown; pinned?: unknown; turns?: unknown; resumeId?: unknown; resumeCli?: unknown }

/** 「没有文件」= 新记录，可以从空开始；「有文件但读不出/解析不了」= 不能用窗口覆盖全量，返回 null 让保存拒绝。 */
function readRaw(file: string): Raw | null {
  let text: string
  try { text = fs.readFileSync(file, 'utf8') } catch (e) { return (e as NodeJS.ErrnoException).code === 'ENOENT' ? {} : null }
  try { return JSON.parse(text) as Raw } catch { return null }
}

/** 空窗口不写盘也不删旧档（与 writeHistorySnapshot 的约定一致）。 */
export function saveArchive(file: string, meta: Meta, incoming: readonly SeqTurn[]): boolean {
  if (!incoming.length) return false
  const previous = readRaw(file)
  if (previous === null) { console.error('[agentHistory] 旧档存在但读不出来，拒绝用窗口覆盖：', file); return false }
  const prevTurns = Array.isArray(previous.turns) ? (previous.turns as SeqTurn[]) : []
  return writeHistorySnapshot(file, {
    moduleId: meta.moduleId ?? (typeof previous.moduleId === 'string' ? previous.moduleId : null),
    pinned: previous.pinned === true,
    v: 2, // v2：turns 带 seq，磁盘为全量
    savedAt: Date.now(),
    resumeId: meta.resumeId,
    resumeCli: meta.resumeCli,
    cwd: meta.cwd,
    turns: mergeArchiveTurns(prevTurns, incoming)
  })
}

export function loadArchiveWindow(file: string, n = HISTORY_WINDOW): { turns: SeqTurn[]; total: number; resumeId: string | null; resumeCli: string | null } {
  const raw = readRaw(file) ?? {}
  const all = Array.isArray(raw.turns) ? assignLegacySeq(raw.turns as SeqTurn[]) : []
  return {
    turns: tailWindow(all, n),
    total: all.length,
    resumeId: typeof raw.resumeId === 'string' ? raw.resumeId : null,
    resumeCli: typeof raw.resumeCli === 'string' ? raw.resumeCli : null
  }
}
