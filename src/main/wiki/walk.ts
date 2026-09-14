// 知识库的目录遍历与目录名映射。**零 electron** —— 从 paths.ts 搬出来（2026-09-13），
// 因为全库扫描要在 Worker 里跑，而 paths.ts 为了 wikiPath() 引了 electron.app。
// paths.ts 原样转出口，调用方不用改。
import fs from 'fs'
import path from 'path'

import { isRawName } from './taxonomy.ts'

const LEGACY: Record<string, string> = {
  '00-inbox': '00-收件箱',
  // me 是后加的，没有中文旧名 —— dirOf 查不到别名就直接返回 'me'
  people: '人物',
  methods: '方法',
  domains: '领域',
  projects: '项目',
  sources: '素材',
  _templates: '_模板'
}

/** 这个库在盘上实际用的目录名：优先英文，老库回落中文 */
export function dirOf(root: string, key: string): string {
  const legacy = LEGACY[key]
  if (!legacy) return key
  try {
    if (!fs.existsSync(path.join(root, key)) && fs.existsSync(path.join(root, legacy))) return legacy
  } catch {
    /* 读不到就按新名走 */
  }
  return key
}

export const isRawDir = (root: string, rel: string): boolean => isRawName(root, rel, (k) => dirOf(root, k))

const MD = new Set(['.md', '.markdown'])
export const isMd = (f: string): boolean => MD.has(path.extname(f).toLowerCase())

/** 递归收集 .md（跳过素材/收件箱和隐藏目录，它们不是笔记） */
export function walkNotes(root: string, rel = '', out: string[] = [], budget = { n: 20000 }
): string[] {
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
      if (isRawDir(root, r)) continue // 原始素材不是笔记，不进索引也不算反链（含老库的中文目录名）
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
