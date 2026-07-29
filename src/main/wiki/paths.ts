// 知识库的位置与盘上形态：配置在哪、目录长什么样、库里现在有多少东西。
//
// 从 wiki.ts 拆出来的第一块。这里只回答「文件在哪、有几个」，
// 不碰内容、不碰 git —— 上面那些都建立在「先能定位」之上，所以它没有任何库内依赖。
import { app } from 'electron'
import fs from 'fs'
import path from 'path'

import type { WikiStatus } from '../../shared/types'

/** 记「库在哪」的配置文件。统计字段（added 等）也放这儿 */
export const cfgFile = (): string => path.join(app.getPath('userData'), 'wiki.json')

/** 顶层目录。刻意只有六个 —— 原文的建议是「别过度设计」，不够用了再加比一开始铺二十个强。 */
export const WIKI_DIRS = ['00-收件箱', '人物', '方法', '领域', '项目', '素材', '_模板']
export const INBOX = WIKI_DIRS[0]
/** 收件箱里记「这份文件原来在哪」的映射表。点号开头 → 访达里不显示，也不会被数进徽章 */
export const SOURCES = '.eas-sources.json'
/** 收件箱里存逐字稿的隐藏目录（点号开头：访达看不见、不进徽章计数） */
export const TRANSCRIPTS = '.逐字稿'

export function wikiPath(): string | null {
  try {
    const v = JSON.parse(fs.readFileSync(cfgFile(), 'utf8')) as { path?: string }
    return typeof v.path === 'string' && v.path ? v.path : null
  } catch {
    return null
  }
}
export function setWikiPath(p: string | null): void {
  fs.mkdirSync(path.dirname(cfgFile()), { recursive: true })
  let cur: Record<string, unknown> = {}
  try {
    cur = JSON.parse(fs.readFileSync(cfgFile(), 'utf8')) as Record<string, unknown>
  } catch {
    cur = {}
  }
  // 保留 added 等统计字段，别因为换个位置就把计数清零
  fs.writeFileSync(cfgFile(), JSON.stringify({ ...cur, path: p }, null, 2))
}

const MD = new Set(['.md', '.markdown'])
export const isMd = (f: string): boolean => MD.has(path.extname(f).toLowerCase())

/** 递归收集 .md（跳过素材/收件箱和隐藏目录，它们不是笔记） */
export function walkNotes(root: string, rel = '', out: string[] = [], budget = { n: 20000 }): string[] {
  if (budget.n <= 0) return out
  let ents: fs.Dirent[]
  try {
    ents = fs.readdirSync(path.join(root, rel), { withFileTypes: true })
  } catch {
    return out
  }
  for (const d of ents) {
    if (budget.n-- <= 0) return out
    if (d.name.startsWith('.')) continue
    const r = rel ? path.join(rel, d.name) : d.name
    if (d.isDirectory()) {
      if (r === INBOX || r === '素材') continue // 原始素材不是笔记，不进索引也不算反链
      walkNotes(root, r, out, budget)
    } else if (d.isFile() && isMd(d.name)) {
      // CLAUDE.md / AGENTS.md 是给 agent 看的**约定文件**，不是笔记。
      // 不排掉的话它们会被当成孤儿页、缺 summary、正文里的 [[双链]] 示例还会被判成死链
      if (rel === '' && (d.name === 'CLAUDE.md' || d.name === 'AGENTS.md')) continue
      out.push(r)
    }
  }
  return out
}

export function wikiStatus(): WikiStatus {
  const p = wikiPath()
  if (!p) return { configured: false, path: null, exists: false, notes: 0, inbox: 0, oldestInboxDays: null, hasGit: false }
  let exists = false
  try {
    exists = fs.statSync(p).isDirectory()
  } catch {
    exists = false
  }
  if (!exists) return { configured: true, path: p, exists: false, notes: 0, inbox: 0, oldestInboxDays: null, hasGit: false }

  const notes = walkNotes(p).length
  // 收件箱压力：不只给数量，还给「最早一份放了多久」——
  // 数字会涨但不扎人，「23 天前」才让人意识到只进不出
  let inbox = 0
  let oldest = Infinity
  try {
    for (const d of fs.readdirSync(path.join(p, INBOX), { withFileTypes: true })) {
      // 和 wiki:inbox 的列表口径必须一致，否则徽章显示 6、点开只有 3 个
      if (d.name.startsWith('.')) continue
      inbox++
      try {
        const st = fs.statSync(path.join(p, INBOX, d.name))
        oldest = Math.min(oldest, st.birthtimeMs || st.mtimeMs)
      } catch {
        /* 读不到就算了 */
      }
    }
  } catch {
    /* 收件箱不存在 */
  }
  return {
    configured: true,
    path: p,
    exists: true,
    notes,
    inbox,
    oldestInboxDays: inbox && Number.isFinite(oldest) ? Math.floor((Date.now() - oldest) / 86400000) : null,
    hasGit: fs.existsSync(path.join(p, '.git'))
  }
}
