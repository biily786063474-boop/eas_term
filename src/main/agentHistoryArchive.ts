// 主进程侧的完整归档：保存 = 读旧档 → 按序号并集 → 原子写；读取 = 只回最近 n 条。
// 零 electron；路径由调用方（agentHistory.ts）校验后传入。
import fs from 'node:fs'
import { writeHistorySnapshot } from './agentHistoryStorage.ts'
import { mergeArchiveTurns, assignLegacySeq, tailWindow, HISTORY_WINDOW, type SeqTurn } from '../shared/historyArchive.ts'

interface Meta { cwd: string | null; resumeId: string | null; resumeCli: string | null; moduleId: string | null }
type Raw = { moduleId?: unknown; pinned?: unknown; turns?: unknown; resumeId?: unknown; resumeCli?: unknown }

function readRaw(file: string): Raw {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) as Raw } catch { return {} }
}

/** 空窗口不写盘也不删旧档（与 writeHistorySnapshot 的约定一致）。 */
export function saveArchive(file: string, meta: Meta, incoming: readonly SeqTurn[]): boolean {
  if (!incoming.length) return false
  const previous = readRaw(file)
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
  const raw = readRaw(file)
  const all = Array.isArray(raw.turns) ? assignLegacySeq(raw.turns as SeqTurn[]) : []
  return {
    turns: tailWindow(all, n),
    total: all.length,
    resumeId: typeof raw.resumeId === 'string' ? raw.resumeId : null,
    resumeCli: typeof raw.resumeCli === 'string' ? raw.resumeCli : null
  }
}
