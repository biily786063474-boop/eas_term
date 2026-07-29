// 个人知识库：一个用户自选位置的 markdown 文件夹。
//
// 设计依据是 Karpathy 的 LLM wiki 模式（原文存档在 docs/reference/karpathy-llm-wiki.md）：
// 不做 RAG，让 agent 把原始素材「编译」成互相链接的笔记，并持续维护。
// 三层：原始素材（不可变）/ wiki（agent 全权拥有）/ schema（CLAUDE.md + AGENTS.md）。
//
// 这个模块只管**文件层**：建骨架、统计、往收件箱放东西、算反向链接。
// 「agent 什么时候该来查」那套规则在 agentRules.ts。
import { app, dialog, ipcMain, shell } from 'electron'
import fs from 'fs'
import path from 'path'

import type { WikiStatus, WikiInboxItem, Backlink } from '../shared/types'

const cfgFile = (): string => path.join(app.getPath('userData'), 'wiki.json')

/** 顶层目录。刻意只有六个 —— 原文的建议是「别过度设计」，不够用了再加比一开始铺二十个强。 */
export const WIKI_DIRS = ['00-收件箱', '人物', '方法', '领域', '项目', '素材', '_模板']
const INBOX = WIKI_DIRS[0]
/** 收件箱里记「这份文件原来在哪」的映射表。点号开头 → 访达里不显示，也不会被数进徽章 */
const SOURCES = '.eas-sources.json'

export function wikiPath(): string | null {
  try {
    const v = JSON.parse(fs.readFileSync(cfgFile(), 'utf8')) as { path?: string }
    return typeof v.path === 'string' && v.path ? v.path : null
  } catch {
    return null
  }
}
function setWikiPath(p: string | null): void {
  fs.mkdirSync(path.dirname(cfgFile()), { recursive: true })
  fs.writeFileSync(cfgFile(), JSON.stringify({ path: p }, null, 2))
}

const MD = new Set(['.md', '.markdown'])
const isMd = (f: string): boolean => MD.has(path.extname(f).toLowerCase())

/** 递归收集 .md（跳过素材/收件箱和隐藏目录，它们不是笔记） */
function walkNotes(root: string, rel = '', out: string[] = [], budget = { n: 20000 }): string[] {
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

// ── 初始化时写进去的内容 ─────────────────────────────────────────

/** 库内 schema。CLAUDE.md 和 AGENTS.md 内容相同 —— 两个 CLI 各自会自动读 cwd 的那一份。 */
function schemaText(): string {
  return `# 这个知识库怎么用

你是这个知识库的维护者，不是通用助手。
用户负责搜集素材、提问题、判断价值；你负责整理、归档、交叉引用和记账。

## 目录

- \`${INBOX}/\` 用户丢进来、还没整理的原始素材
- \`人物/\` 博主 / 作者：思维模型、行为习惯、代表作、用户的实测反馈
- \`方法/\` 可迁移的做法（跨领域组织，不按学科切）
- \`领域/\` 编程 / 设计 / 剪辑 / 文案
- \`项目/\` 决策记录与复盘
- \`素材/\` 归档后的原件与逐字稿
- \`index.md\` 全库目录：每页一行链接 + 一句话摘要
- \`log.md\` 只追加的时间线

## 三条不可违反

1. **\`素材/\` 和 \`${INBOX}/\` 里的原始文件只读。** 可以移动、可以重命名，
   **绝不修改内容、绝不删除**。它们是真相来源。
2. **重名不覆盖**，加后缀。
3. **归档前先出计划给用户过目**：哪个文件去哪、生成哪篇笔记、会牵动哪些老笔记。
   用户确认后才动手。

## 笔记格式

每篇都要有 front-matter。\`summary\` 和 \`tags\` 是硬要求——
索引和检索全靠它们，缺了这个库一过百篇就没法用。

\`\`\`
---
summary: 一句话说清这篇讲什么
tags: [标签1, 标签2]
source: 素材/2026-07/xxx.mp4
people: [[某某]]
created: 2026-07-29
updated: 2026-07-29
---
\`\`\`

正文用 \`[[双链]]\` 互指。人物、方法、概念第一次出现就该有自己的页面。

## 三个动作

### Ingest（归档）
读素材 → 和用户讨论要点 → 写摘要页 → 更新 \`index.md\` →
更新被牵动的人物/概念页（一份素材通常会碰 10–15 页）→ 往 \`log.md\` 追加一条。

默认**一次一份、人在场**。用户明确要求批量时才批量，并先给出条数和成本预估。

### Query（查询）
先读 \`index.md\`，挑相关页读，回答带出处。

**好答案要归档回知识库**：用户觉得有价值的对比、分析、结论，
问他「要不要存成一篇」，同意就写成新页并更新索引。
探索本身也该参与复利，不要让它消散在聊天记录里。

### Lint（体检）
用户要求时才跑。检查：页面之间的矛盾、被新素材推翻的旧结论、
没有任何入链的孤儿页、反复被提到却没有独立页面的概念、该连没连的交叉引用。
**只出报告，不自动改**——改什么由用户点头。

## log.md 的格式

每条以固定前缀开头，方便 \`grep "^## \\[" log.md | tail -5\` 看最近动静：

\`\`\`
## [2026-07-29] ingest | 某某-如何做口播
## [2026-07-29] query  | 口播节奏怎么把控
## [2026-07-30] lint   | 发现 3 处矛盾、2 个孤儿页
\`\`\`
`
}

const INDEX_MD = `# 索引

全库目录。每页一行：链接 + 一句话摘要。**每次 ingest 后由 agent 更新。**
回答问题时先读这一页，再决定深入哪几篇——这样判断「要不要读」只花一个文件的钱。

## 人物

## 方法

## 领域

## 项目
`

const LOG_MD = `# 日志

只追加。每条以 \`## [日期] 动作 | 标题\` 开头，方便 \`grep "^## \\[" log.md | tail -5\`。
`

function readmeText(): string {
  return `---
summary: 这个知识库怎么用（初始化时自动生成，可以随便改或删）
tags: [说明]
created: ${new Date().toISOString().slice(0, 10)}
---

# 从这里开始

## 你要做的只有两件事

1. **把东西丢进 \`${INBOX}/\`** —— 视频、文章、截图、随手记的想法，什么都行，不用整理。
2. **干活时随口问** —— 「上次那个口播节奏是怎么定的」「有没有现成的方法」。

剩下的归类、写笔记、连交叉引用，都是 agent 的活。

## 为什么不是搜索

这不是一个搜索引擎，是一个**会自己长大的笔记本**。
每加一份素材、每问一个问题，它都比之前更厚一点——
而且厚的是**已经想明白的部分**，不是原始材料的堆积。

## 三个动作

| 动作 | 你说什么 |
|---|---|
| 归档 | 「整理一下收件箱」 |
| 查询 | 直接问就行，agent 会自己来查 |
| 体检 | 「给知识库做个体检」——找矛盾、过期结论、没人链接的孤儿页 |

## 一件要知道的事

**\`素材/\` 和 \`${INBOX}/\` 里的原件，agent 只读不改。**
它可以移动位置、可以重命名，但不会修改内容、不会删除。
那些是你的真相来源。

参考：[[index]]
`
}

/** 建骨架。已存在的文件一律不覆盖 —— 允许用户把已有的 Obsidian 库直接指过来。 */
function initWiki(root: string): { created: string[]; skipped: string[] } {
  const created: string[] = []
  const skipped: string[] = []
  fs.mkdirSync(root, { recursive: true })
  for (const d of WIKI_DIRS) {
    const p = path.join(root, d)
    if (fs.existsSync(p)) skipped.push(d + '/')
    else {
      fs.mkdirSync(p, { recursive: true })
      created.push(d + '/')
    }
  }
  const files: [string, string][] = [
    ['CLAUDE.md', schemaText()],
    ['AGENTS.md', schemaText()],
    ['index.md', INDEX_MD],
    ['log.md', LOG_MD],
    ['从这里开始.md', readmeText()]
  ]
  for (const [name, body] of files) {
    const p = path.join(root, name)
    if (fs.existsSync(p)) skipped.push(name)
    else {
      fs.writeFileSync(p, body)
      created.push(name)
    }
  }
  return { created, skipped }
}

/** 重名不覆盖：a.md → a-2.md → a-3.md */
function uniqueName(dir: string, name: string): string {
  const ext = path.extname(name)
  const base = name.slice(0, name.length - ext.length)
  let n = 1
  let out = name
  while (fs.existsSync(path.join(dir, out))) out = `${base}-${++n}${ext}`
  return out
}

export function registerWikiHandlers(): void {
  ipcMain.handle('wiki:status', () => wikiStatus())

  ipcMain.handle('wiki:pickPath', async () => {
    const r = await dialog.showOpenDialog({
      title: '选择知识库位置',
      properties: ['openDirectory', 'createDirectory'],
      buttonLabel: '就用这里'
    })
    return r.canceled ? null : (r.filePaths[0] ?? null)
  })

  /** 默认建议位置。绝不放 app 内部 —— 卸载或升级会连人带货一起没 */
  ipcMain.handle('wiki:suggestPath', () =>
    path.join(app.getPath('documents'), 'Eas 知识库')
  )

  /** 收件箱的「＋」入口：多选文件。拖拽之外必须有这个——不习惯拖的人也得进得来 */
  ipcMain.handle('wiki:pickFiles', async (): Promise<string[]> => {
    const r = await dialog.showOpenDialog({
      title: '选择要放进收件箱的文件',
      properties: ['openFile', 'multiSelections'],
      buttonLabel: '放进收件箱'
    })
    return r.canceled ? [] : r.filePaths
  })

  ipcMain.handle('wiki:init', (_e, root: string) => {
    if (!root || !path.isAbsolute(root)) return { ok: false, error: '需要绝对路径' }
    try {
      const r = initWiki(root)
      setWikiPath(root)
      return { ok: true, ...r, status: wikiStatus() }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('wiki:forget', () => {
    // 只忘掉位置，不删任何文件 —— 用户的笔记不该因为一次点击消失
    setWikiPath(null)
    return wikiStatus()
  })

  ipcMain.handle('wiki:reveal', (_e, sub?: string) => {
    const p = wikiPath()
    if (!p) return
    const target = sub ? path.join(p, sub) : p
    shell.openPath(target)
  })

  /**
   * 往收件箱放文件。**默认复制不移动** —— 移动会让用户原来放文件的地方东西没了，
   * 这是最容易挨骂的一类操作。来源路径记在旁边的 .source 里，归档时能追溯。
   */
  ipcMain.handle('wiki:addToInbox', async (_e, files: string[], move = false) => {
    const root = wikiPath()
    if (!root) return { ok: false, error: '还没设置知识库位置' }
    const dir = path.join(root, INBOX)
    try {
      fs.mkdirSync(dir, { recursive: true })
    } catch {
      /* 已存在 */
    }
    const done: string[] = []
    const failed: { file: string; error: string }[] = []
    const srcFile = path.join(dir, SOURCES)
    let sources: Record<string, string> = {}
    try {
      sources = JSON.parse(fs.readFileSync(srcFile, 'utf8')) as Record<string, string>
    } catch {
      sources = {}
    }
    for (const f of files) {
      try {
        const st = await fs.promises.stat(f)
        if (st.isDirectory()) {
          failed.push({ file: f, error: '暂不支持整个文件夹' })
          continue
        }
        const name = uniqueName(dir, path.basename(f))
        const dest = path.join(dir, name)
        if (move) await fs.promises.rename(f, dest)
        else await fs.promises.copyFile(f, dest)
        // 记来源：归档写笔记时 front-matter 的 source 就有出处，不靠猜。
        // 用一份隐藏的映射表而不是每个文件一个 .source 旁车——
        // 旁车会在访达里和原文件并排显示，把收件箱弄得很脏（而且会被数进徽章）
        sources[name] = f
        done.push(name)
      } catch (e) {
        failed.push({ file: f, error: e instanceof Error ? e.message : String(e) })
      }
    }
    try {
      fs.writeFileSync(srcFile, JSON.stringify(sources, null, 2))
    } catch {
      /* 来源表写不进去不影响文件已经放进来这件事 */
    }
    return { ok: true, done, failed, status: wikiStatus() }
  })

  ipcMain.handle('wiki:inbox', (): WikiInboxItem[] => {
    const root = wikiPath()
    if (!root) return []
    const dir = path.join(root, INBOX)
    try {
      return fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((d) => !d.name.startsWith('.'))
        .map((d) => {
          const full = path.join(dir, d.name)
          let size = 0
          let at = 0
          try {
            const st = fs.statSync(full)
            size = st.size
            at = st.birthtimeMs || st.mtimeMs
          } catch {
            /* 读不到就给 0 */
          }
          return { name: d.name, path: full, isDir: d.isDirectory(), size, at }
        })
        .sort((a, b) => a.at - b.at) // 最早的排前面：要处理的正是它
    } catch {
      return []
    }
  })

  /**
   * 反向链接：谁引用了这一篇。
   * 全库扫一遍 [[链接]] —— 几百篇的规模下这点 IO 可以忽略，
   * 上千篇再谈索引缓存（那时候本来也该接 qmd 了）。
   */
  ipcMain.handle('wiki:backlinks', (_e, target: string): Backlink[] => {
    const root = wikiPath()
    if (!root) return []
    // [[链接]] 里写的通常是标题（不带扩展名），也允许写相对路径
    const stem = path.basename(target, path.extname(target))
    const out: Backlink[] = []
    for (const rel of walkNotes(root)) {
      if (path.basename(rel, path.extname(rel)) === stem) continue // 自己不算
      let text: string
      try {
        text = fs.readFileSync(path.join(root, rel), 'utf8')
      } catch {
        continue
      }
      const lines = text.split('\n')
      for (let i = 0; i < lines.length; i++) {
        // [[标题]] 或 [[标题|显示名]]、[[路径/标题]]
        for (const m of lines[i].matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)) {
          const nameOnly = path.basename(m[1].trim())
          if (nameOnly === stem || m[1].trim() === stem) {
            out.push({ file: rel, line: i + 1, text: lines[i].trim().slice(0, 160) })
            break
          }
        }
      }
    }
    return out
  })
}
