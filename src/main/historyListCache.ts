// 历史面板的列表/搜索索引缓存（2026-09-14，完整归档之后文件会变大）。
// 按「文件 + mtime + size」缓存摘要与小写正文；没变的文件不再解析，删掉的自然消失。
// 零 electron；parse 可注入，测试用。
import fs from 'node:fs'
import path from 'node:path'
import { historySummary, type HistorySummary } from '../shared/historyCatalog.ts'

type Raw = { cwd?: unknown; moduleId?: unknown; pinned?: unknown; savedAt?: unknown; resumeId?: unknown; turns?: { role?: string; text?: string }[] }
interface Entry { mtimeMs: number; size: number; cwd: unknown; summary: HistorySummary; text: string }

export function createHistoryListCache(deps: { parse?: (file: string) => Raw } = {}) {
  const parse = deps.parse ?? ((file: string) => JSON.parse(fs.readFileSync(file, 'utf8')) as Raw)
  const entries = new Map<string, Entry>()
  return {
    list(dir: string, cwd: string, query: string): HistorySummary[] {
      let names: string[]
      try { names = fs.readdirSync(dir).filter(f => f.endsWith('.json')) } catch { return [] }
      const seen = new Set<string>()
      const q = query.trim().toLocaleLowerCase()
      const out: HistorySummary[] = []
      for (const n of names) {
        const file = path.join(dir, n)
        seen.add(file)
        try {
          const st = fs.statSync(file)
          let e = entries.get(file)
          if (!e || e.mtimeMs !== st.mtimeMs || e.size !== st.size) {
            const raw = parse(file)
            const turns = Array.isArray(raw.turns) ? raw.turns : []
            if (!turns.length) { entries.delete(file); continue }
            e = { mtimeMs: st.mtimeMs, size: st.size, cwd: raw.cwd, summary: historySummary(n.replace(/\.json$/, ''), raw), text: turns.map(t => (typeof t?.text === 'string' ? t.text : '')).join('\n').toLocaleLowerCase() }
            entries.set(file, e)
          }
          if (e.cwd !== cwd) continue
          if (q && !e.text.includes(q)) continue
          out.push(e.summary)
        } catch { entries.delete(file) /* 坏文件跳过，不能让一份坏记录挡住整个列表 */ }
      }
      for (const k of [...entries.keys()]) if (!seen.has(k)) entries.delete(k)
      return out.sort((a, b) => b.savedAt - a.savedAt)
    }
  }
}
