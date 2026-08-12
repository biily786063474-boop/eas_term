// 知识库的位置与盘上形态：配置在哪、目录长什么样、库里现在有多少东西。
//
// 从 wiki.ts 拆出来的第一块。这里只回答「文件在哪、有几个」，
// 不碰内容、不碰 git —— 上面那些都建立在「先能定位」之上，所以它没有任何库内依赖。
import { app } from 'electron'
import fs from 'fs'
import path from 'path'

import type { WikiStatus } from '../../shared/types'
import { isRawName, libraryDirs, TAXONOMY_FILE } from './taxonomy'

/** 记「库在哪」的配置文件。统计字段（added 等）也放这儿 */
export const cfgFile = (): string => path.join(app.getPath('userData'), 'wiki.json')

/**
 * 顶层目录。数量刻意压着 —— 原文的建议是「别过度设计」，不够用了再加比一开始铺二十个强。
 *
 * `me/` 是唯一一个「关于使用者自己」的分区，和 `people/` 必须分开：
 * people/ 装的是**别人**（博主、作者），是研究对象；me/ 装的是**你自己**
 * （画像、工作习惯、方法论、决策偏好）。混在一起的话，agent 查「某人的方法」时
 * 会把你和别人的东西一起端上来。
 *
 * **全英文、无空格。** 这些名字会被拼进 shell 命令、agent 的规则文本、URL 和脚本参数，
 * 每多一个空格就多一处引号漏了就出错的地方 —— 本项目自己就被路径里的一个空格
 * 坑掉过一次 node-pty 编译。中文目录名本身不出错，但英文让 agent 引用时不用纠结引号。
 */
export const WIKI_DIRS = [
  '00-inbox',
  'me',
  'people',
  'methods',
  'domains',
  'projects',
  'sources',
  '_templates'
]

/** 收件箱里记「这份文件原来在哪」的映射表。点号开头 → 访达里不显示，也不会被数进徽章 */
export const SOURCES = '.eas-sources.json'

/**
 * 老库兼容表：英文名 → 曾经用的中文名。
 *
 * 改名之前建的库（目录是中文的）直接指过来也必须能用 —— 否则用户换个版本
 * 就发现「知识库空了」，而文件明明还在盘上。这个坑刚踩过一次，不能靠改名再造一次。
 * 判据是**盘上有哪个用哪个**，不做自动搬迁：搬用户的文件该由用户在访达里决定。
 */
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

export const INBOX = '00-inbox'

/** 这个库的收件箱目录名。自定义库按配置里 role:"inbox" 那个，内置库还是 00-inbox
 *  （含老库中文名回落）。 */
export const inboxOf = (root: string): string =>
  libraryDirs(root, (k) => dirOf(root, k)).find((d) => d.role === 'inbox')?.name ?? dirOf(root, INBOX)
export const sourcesOf = (root: string): string => dirOf(root, 'sources')

/** 原始素材区（收件箱 + 素材）：不是笔记，不进索引也不算反链。
 *  **签名多收一个 root**：自定义库的原始素材区叫什么由配置决定，不看名字。
 *  唯一调用点是下面的 walkNotes，它本来就有 root。
 *  判定逻辑在 taxonomy.ts 的 isRawName（那边不引 electron，测试能直接打到实现）——
 *  这里只做一行转发：把 dirOf 注入当 resolve。 */
export const isRawDir = (root: string, rel: string): boolean => isRawName(root, rel, (k) => dirOf(root, k))

/** 收件箱里存逐字稿的隐藏目录（点号开头：访达看不见、不进徽章计数） */
export const TRANSCRIPTS = '.transcripts'
/** 老库的逐字稿目录叫 .逐字稿，同样是有哪个用哪个 */
export function transcriptsOf(inboxAbs: string): string {
  try {
    if (!fs.existsSync(path.join(inboxAbs, TRANSCRIPTS)) && fs.existsSync(path.join(inboxAbs, '.逐字稿')))
      return '.逐字稿'
  } catch {
    /* 按新名走 */
  }
  return TRANSCRIPTS
}

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

/** 这个目录里有没有知识库该有的东西。判据取最宽松的一组：
 *  骨架文件或任一顶层目录（含老库中文名）存在，就认。全都看不到才叫「不像」。 */
function looksLikeWiki(root: string): boolean {
  try {
    // 有分类配置 = 明确是我们的库，不用再看目录长什么样
    if (fs.existsSync(path.join(root, TAXONOMY_FILE))) return true
    for (const f of ['index.md', 'CLAUDE.md', 'AGENTS.md', 'log.md']) {
      if (fs.existsSync(path.join(root, f))) return true
    }
    for (const key of WIKI_DIRS) {
      if (fs.existsSync(path.join(root, dirOf(root, key)))) return true
    }
  } catch {
    /* 读不到就是不像 */
  }
  return false
}

export function wikiStatus(): WikiStatus {
  const p = wikiPath()
  if (!p)
    return { configured: false, path: null, exists: false, notes: 0, inbox: 0, oldestInboxDays: null, hasGit: false, looksEmpty: false }
  let exists = false
  try {
    exists = fs.statSync(p).isDirectory()
  } catch {
    exists = false
  }
  if (!exists)
    return { configured: true, path: p, exists: false, notes: 0, inbox: 0, oldestInboxDays: null, hasGit: false, looksEmpty: false }

  const notes = walkNotes(p).length
  // 收件箱压力：不只给数量，还给「最早一份放了多久」——
  // 数字会涨但不扎人，「23 天前」才让人意识到只进不出
  let inbox = 0
  let oldest = Infinity
  try {
    const inboxDir = inboxOf(p) // 别叫 inbox —— 上面那个 inbox 是计数器
    for (const d of fs.readdirSync(path.join(p, inboxDir), { withFileTypes: true })) {
      // 和 wiki:inbox 的列表口径必须一致，否则徽章显示 6、点开只有 3 个
      if (d.name.startsWith('.')) continue
      inbox++
      try {
        const st = fs.statSync(path.join(p, inboxDir, d.name))
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
    hasGit: fs.existsSync(path.join(p, '.git')),
    // 骨架一个都看不到 → 这不像一个知识库。要么指错了目录，要么这个目录读不出来
    // （网络卷没权限、挂载失效）。和「刚建好的空库」区分开 —— 后者至少有 index.md。
    looksEmpty: !looksLikeWiki(p)
  }
}
