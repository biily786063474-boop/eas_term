// 个人知识库：一个用户自选位置的 markdown 文件夹。
//
// 设计依据是 Karpathy 的 LLM wiki 模式（原文存档在 docs/reference/karpathy-llm-wiki.md）：
// 不做 RAG，让 agent 把原始素材「编译」成互相链接的笔记，并持续维护。
// 三层：原始素材（不可变）/ wiki（agent 全权拥有）/ schema（CLAUDE.md + AGENTS.md）。
//
// 这个模块只管**文件层**：建骨架、统计、往收件箱放东西、算反向链接。
// 「agent 什么时候该来查」那套规则在 agentRules.ts。
import { app, dialog, ipcMain, shell } from 'electron'
import { execFileSync } from 'child_process'
import fs from 'fs'
import path from 'path'

import type {
  WikiStatus,
  WikiInboxItem,
  Backlink,
  WikiHit,
  ArchiveItem,
  WikiCommit,
  WikiGraph,
  LintFinding,
  WikiStats
} from '../shared/types'

const cfgFile = (): string => path.join(app.getPath('userData'), 'wiki.json')

/** 顶层目录。刻意只有六个 —— 原文的建议是「别过度设计」，不够用了再加比一开始铺二十个强。 */
export const WIKI_DIRS = ['00-收件箱', '人物', '方法', '领域', '项目', '素材', '_模板']
const INBOX = WIKI_DIRS[0]
/** 收件箱里记「这份文件原来在哪」的映射表。点号开头 → 访达里不显示，也不会被数进徽章 */
const SOURCES = '.eas-sources.json'
/** 收件箱里存逐字稿的隐藏目录（点号开头：访达看不见、不进徽章计数） */
const TRANSCRIPTS = '.逐字稿'

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

// ── 初始化时写进去的内容 ─────────────────────────────────────────

/** 库内 schema。CLAUDE.md 和 AGENTS.md 内容相同 —— 两个 CLI 各自会自动读 cwd 的那一份。 */
/** 约定文件的版本标记。升级时靠它判断「这份是我们生成的」→ 可以安全覆盖；
 *  没有标记就是用户自己写的，一个字都不碰。 */
const SCHEMA_MARK = '<!-- eas-term:wiki-schema v2 -->'

function schemaText(): string {
  return `${SCHEMA_MARK}
# 这个知识库怎么用

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

**不要自己搬文件。** 按这个顺序走，每一步都有对应的工具：

1. \`wiki_inbox\` —— 看收件箱里有什么
2. \`wiki_transcript\` —— 视频/音频拿逐字稿（本机已离线转好，不花 token）
3. \`wiki_archive_plan\` —— 一次提交整批计划。**这个调用会阻塞几十秒到几分钟等用户
   在界面上逐条过目并确认，是正常的。** 用户没批准的条目一个都不要动
4. \`wiki_archive_exec\` —— 搬被批准的文件（只搬文件，笔记要你自己写）
5. 写摘要页 → 更新 \`index.md\` → 更新被牵动的人物/概念页（一份素材通常会碰 10–15 页）
6. \`wiki_log\`（action=ingest）

默认**一次一份、人在场**。用户明确要求批量时才批量，并先给出条数和成本预估。

### Query（查询）
先读 \`index.md\`，挑相关页读，回答带出处。**答完调一次 \`wiki_log\`（action=query）。**

那一步不能省：它既是知识库的时间线，也是「放入多少次 vs 真去查了多少次」的**唯一**数据来源。
不记的话查询数永远是 0，用户会看到一个「只进不出」的假象。

**好答案要归档回知识库**：用户觉得有价值的对比、分析、结论，
问他「要不要存成一篇」，同意就写成新页并更新索引。
探索本身也该参与复利，不要让它消散在聊天记录里。

### Lint（体检）
用户要求时才跑。先调 \`wiki_lint\` 拿**结构问题**（死链、孤儿页、缺 summary/tags、
索引漏收——免费瞬时算出来的，你不用自己扫全库），再去做需要**读懂内容**才能发现的那半边：
页面之间的矛盾、被新素材推翻的旧结论、反复被提到却没有独立页面的概念。
**只出报告，不自动改**——改什么由用户点头。完事调 \`wiki_log\`（action=lint）。

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
    if (!fs.existsSync(p)) {
      fs.writeFileSync(p, body)
      created.push(name)
      continue
    }
    // 约定文件（CLAUDE.md / AGENTS.md）带我们的标记 → 是上一版生成的，升级时覆盖成新规矩；
    // 没有标记 = 用户自己写的（比如把已有的 Obsidian 库指过来），一个字都不碰。
    // 不这么做的话，老知识库会永远停在旧约定上——新加的工具它根本不知道
    const isSchema = name === 'CLAUDE.md' || name === 'AGENTS.md'
    if (isSchema) {
      try {
        const cur = fs.readFileSync(p, 'utf8')
        if (cur.includes('eas-term:wiki-schema') && cur !== body) {
          fs.writeFileSync(p, body)
          created.push(name + '（已更新到新版约定）')
          continue
        }
      } catch {
        /* 读不了就当用户的，别动 */
      }
    }
    skipped.push(name)
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

// ── git：AI 动用户文件时唯一能**整体**撤销的机制 ─────────────────────
//
// 为什么非要它：一次归档会移动若干原件、新建若干笔记、还会改十几篇老笔记的双链。
// 出问题时靠人工逐个还原是不可能的。原文也直说了：
// 「The wiki is just a git repo of markdown files. You get version history … for free.」
//
// 全部走 execFileSync + 参数数组，不拼 shell 字符串——路径里有空格中文都不会出事。
const MARK = '[eas]' // 我们打的 commit 前缀，回滚列表按它筛

function git(root: string, args: string[]): string {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 16 * 1024 * 1024
  })
}
function gitOk(root: string, args: string[]): boolean {
  try {
    git(root, args)
    return true
  } catch {
    return false
  }
}
function isRepo(root: string): boolean {
  return gitOk(root, ['rev-parse', '--git-dir'])
}
/** 工作区有没有未提交的改动 */
function isDirty(root: string): boolean {
  try {
    return git(root, ['status', '--porcelain']).trim().length > 0
  } catch {
    return true
  }
}

/** 提交当前全部改动。没有改动就返回当前 HEAD（不产生空提交） */
function commitAll(root: string, message: string): string | null {
  try {
    if (isDirty(root)) {
      git(root, ['add', '-A'])
      git(root, ['commit', '-m', `${MARK} ${message}`, '--no-verify'])
    }
    return git(root, ['rev-parse', 'HEAD']).trim()
  } catch {
    return null
  }
}

/** 一篇笔记的原始信息：给图谱和体检共用，只扫一遍盘 */
interface NoteInfo {
  rel: string
  title: string
  summary: string
  tags: string[]
  links: string[]
  mtime: number
  /** 去掉 front-matter 后的正文字数（按字符不按字节：中文一个字三字节，
   *  用字节判「太薄」会把正常长度的中文笔记全误报） */
  bodyChars: number
}

function scanNotes(root: string): NoteInfo[] {
  const out: NoteInfo[] = []
  for (const rel of walkNotes(root)) {
    let text = ''
    let mtime = 0
    try {
      const full = path.join(root, rel)
      text = fs.readFileSync(full, 'utf8')
      mtime = fs.statSync(full).mtimeMs
    } catch {
      continue
    }
    const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
    let summary = ''
    let tags: string[] = []
    if (fm) {
      for (const line of fm[1].split('\n')) {
        const kv = /^(\w+)\s*:\s*(.*)$/.exec(line.trim())
        if (!kv) continue
        if (kv[1] === 'summary') summary = kv[2].trim()
        else if (kv[1] === 'tags')
          tags = kv[2].replace(/^\[|\]$/g, '').split(',').map((t) => t.trim().replace(/^#/, '')).filter(Boolean)
      }
    }
    const links = [...text.matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)].map((m) =>
      path.basename(m[1].trim())
    )
    const body = fm ? text.slice(fm[0].length) : text
    out.push({
      rel,
      title: path.basename(rel, path.extname(rel)),
      summary,
      tags,
      links,
      mtime,
      bodyChars: body.replace(/\s/g, '').length
    })
  }
  return out
}

export function registerWikiHandlers(): void {
  /**
   * 知识图谱：节点=笔记，边=[[双链]]。
   *
   * 卡帕西原话说 Obsidian 的图谱是「看清 wiki 形状最好的方式 —— 什么连着什么、
   * 哪些是枢纽、哪些是孤儿」。注意他说的用途是**看形状**，不是日常查询，
   * 所以这块和体检放在一起做（孤儿页正是体检要处理的东西）。
   */
  ipcMain.handle('wiki:graph', (): WikiGraph => {
    const root = wikiPath()
    if (!root) return { nodes: [], edges: [] }
    const notes = scanNotes(root)
    const byTitle = new Map(notes.map((n) => [n.title, n.rel]))
    const inbound = new Map<string, number>()
    const edges: { from: string; to: string }[] = []
    for (const n of notes) {
      for (const l of new Set(n.links)) {
        const target = byTitle.get(l)
        if (!target || target === n.rel) continue // 死链不画（体检会单独报）
        edges.push({ from: n.rel, to: target })
        inbound.set(target, (inbound.get(target) ?? 0) + 1)
      }
    }
    return {
      nodes: notes.map((n) => ({
        id: n.rel,
        title: n.title,
        tags: n.tags,
        inbound: inbound.get(n.rel) ?? 0,
        outbound: new Set(n.links.filter((l) => byTitle.has(l))).size
      })),
      edges
    }
  })

  /**
   * 体检的**结构部分**。
   *
   * 分工要说清楚：矛盾、过期结论这些需要真读懂内容，那是 agent 的活；
   * 这里只做纯结构检查 —— 免费、瞬时、结果确定。
   * agent 拿到这份清单后再去做语义那半边，不用自己先把整个库扫一遍。
   */
  ipcMain.handle('wiki:lint', (): LintFinding[] => {
    const root = wikiPath()
    if (!root) return []
    const notes = scanNotes(root)
    const byTitle = new Map(notes.map((n) => [n.title, n.rel]))
    const inbound = new Map<string, number>()
    for (const n of notes)
      for (const l of new Set(n.links))
        if (byTitle.has(l) && byTitle.get(l) !== n.rel)
          inbound.set(byTitle.get(l)!, (inbound.get(byTitle.get(l)!) ?? 0) + 1)

    const out: LintFinding[] = []
    const SKIP = new Set(['index', 'log', '从这里开始'])
    const now = Date.now()
    for (const n of notes) {
      if (SKIP.has(n.title)) continue
      // 死链：写了 [[X]] 但库里没有 X。最该先修的一类——它是「本该有页却还没写」的信号
      for (const l of new Set(n.links)) {
        if (!byTitle.has(l))
          out.push({ kind: 'deadlink', file: n.rel, detail: `[[${l}]] 指向的笔记不存在`, hint: '要么建这一页，要么改掉链接' })
      }
      if (!n.summary)
        out.push({ kind: 'nosummary', file: n.rel, detail: '缺 summary', hint: 'agent 靠它判断相关性，缺了这个库一过百篇就没法用' })
      if (!n.tags.length) out.push({ kind: 'notags', file: n.rel, detail: '缺 tags', hint: '同上' })
      if (!(inbound.get(n.rel) ?? 0))
        out.push({ kind: 'orphan', file: n.rel, detail: '没有任何笔记链接到它', hint: '要么从相关笔记连过来，要么它本来就该被合并掉' })
      const days = Math.floor((now - n.mtime) / 86400000)
      if (days > 180)
        out.push({ kind: 'stale', file: n.rel, detail: `${days} 天没动过`, hint: '看看还成不成立，或者有没有被新素材推翻' })
      if (n.bodyChars < 80)
        out.push({ kind: 'thin', file: n.rel, detail: `正文只有 ${n.bodyChars} 字`, hint: '要么写完，要么并进别的页' })
    }
    // index.md 该收录却没收录的
    try {
      const idx = fs.readFileSync(path.join(root, 'index.md'), 'utf8')
      // 聚合成一条：漏收通常是成片发生的（比如索引一直没人维护），
      // 逐条列出来就是几十行一模一样的内容，没人看得下去
      const miss = notes.filter((n) => !SKIP.has(n.title) && !idx.includes(n.title))
      if (miss.length)
        out.push({
          kind: 'noindex',
          file: 'index.md',
          detail: `${miss.length} 篇没进索引：${miss.slice(0, 6).map((n) => n.title).join('、')}${miss.length > 6 ? ' 等' : ''}`,
          hint: '索引是 agent 回答问题时唯一先读的东西，漏了等于这几页不存在'
        })
    } catch {
      /* 没有 index.md */
    }
    return out
  })

  /**
   * 往 log.md 追加一条。格式固定成 `## [日期] 动作 | 标题`，
   * 这样 `grep "^## \[" log.md | tail -5` 能直接看最近动静（原文给的技巧）。
   * 同时它也是「放入 vs 查询」统计的唯一数据源。
   */
  ipcMain.handle('wiki:log', (_e, action: string, title: string) => {
    const root = wikiPath()
    if (!root) return { ok: false }
    const act = ['ingest', 'query', 'lint'].includes(String(action)) ? String(action) : 'query'
    try {
      const f = path.join(root, 'log.md')
      const day = new Date().toISOString().slice(0, 10)
      const line = `\n## [${day}] ${act} | ${String(title).replace(/\n/g, ' ').slice(0, 120)}\n`
      fs.appendFileSync(f, line)
      return { ok: true }
    } catch {
      return { ok: false }
    }
  })

  /**
   * 放入 vs 查询。
   *
   * 这是「这东西是不是变成了数字仓鼠窝」的唯一判据：
   * 一个月后如果放 100 次问 3 次，说明它没长成工具、只长成了仓库。
   * 数据来自 log.md（agent 按约定记）+ 我们自己记的放入次数，两边都不完美，
   * 但方向足够说明问题。
   */
  ipcMain.handle('wiki:stats', (): WikiStats => {
    const root = wikiPath()
    const empty = { added: 0, ingest: 0, query: 0, lint: 0, notes: 0 }
    if (!root) return empty
    let ingest = 0
    let query = 0
    let lint = 0
    try {
      for (const l of fs.readFileSync(path.join(root, 'log.md'), 'utf8').split('\n')) {
        const m = /^## \[[\d-]+\]\s*(\w+)/.exec(l.trim())
        if (!m) continue
        if (m[1] === 'ingest') ingest++
        else if (m[1] === 'query') query++
        else if (m[1] === 'lint') lint++
      }
    } catch {
      /* 没有 log.md */
    }
    let added = 0
    try {
      added = Number(
        (JSON.parse(fs.readFileSync(cfgFile(), 'utf8') || '{}') as { added?: number }).added ?? 0
      )
    } catch {
      added = 0
    }
    return { added, ingest, query, lint, notes: walkNotes(root).length }
  })

  ipcMain.handle('wiki:gitInit', () => {
    const root = wikiPath()
    if (!root) return { ok: false, error: '还没设置知识库位置' }
    try {
      if (!isRepo(root)) {
        git(root, ['init'])
        // **收件箱绝不能 gitignore。**
        // 曾经这么写过（理由是「大视频不该进版本库」），结果是个会毁文件的洞：
        // 归档把文件从「不受管的收件箱」搬进「受管的素材/」，回滚时 git 会把它从
        // 素材/ 删掉，而收件箱里早就没有了 —— 文件彻底消失。
        // 而且那个理由本身不成立：同一批大文件归档后照样进 素材/ 并被跟踪，
        // 忽略收件箱一个字节都没省下，只换来了这个洞。
        const ig = path.join(root, '.gitignore')
        if (!fs.existsSync(ig)) fs.writeFileSync(ig, '.DS_Store\n.eas-sources.json\n')
      }
      const sha = commitAll(root, '初始化')
      return { ok: true, sha, status: wikiStatus() }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  /** 归档前的快照：把当前状态先落一个提交，回滚就退到这里 */
  ipcMain.handle('wiki:snapshot', (_e, label: string) => {
    const root = wikiPath()
    if (!root || !isRepo(root)) return { ok: false, error: '知识库还没用 git 管起来' }
    const sha = commitAll(root, `归档前快照 · ${label}`)
    return sha ? { ok: true, sha } : { ok: false, error: '快照失败' }
  })

  ipcMain.handle('wiki:commit', (_e, message: string) => {
    const root = wikiPath()
    if (!root || !isRepo(root)) return { ok: false, error: '知识库还没用 git 管起来' }
    const sha = commitAll(root, message)
    return sha ? { ok: true, sha } : { ok: false, error: '提交失败' }
  })

  ipcMain.handle('wiki:history', (_e, limit = 20): WikiCommit[] => {
    const root = wikiPath()
    if (!root || !isRepo(root)) return []
    try {
      return git(root, ['log', `-${limit}`, '--pretty=format:%H\u0001%at\u0001%s'])
        .split('\n')
        .filter(Boolean)
        .map((l) => {
          const [sha, at, subject] = l.split('\u0001')
          return { sha, at: Number(at) * 1000, subject, mine: subject.startsWith(MARK) }
        })
    } catch {
      return []
    }
  })

  /** 一键回滚到某个提交。**只在我们自己打的提交之间用**，且会先把当前状态另存一个提交，
   *  这样「回滚」本身也是可撤销的——用户后悔了还能再回来。 */
  ipcMain.handle('wiki:rollback', (_e, sha: string) => {
    const root = wikiPath()
    if (!root || !isRepo(root)) return { ok: false, error: '知识库还没用 git 管起来' }
    try {
      commitAll(root, '回滚前保留现场')
      git(root, ['reset', '--hard', sha])
      return { ok: true, status: wikiStatus() }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  /**
   * 执行归档的**文件搬运**部分：把收件箱里的原件挪到 素材/<年月>/。
   * 写笔记是 agent 的活，这里只负责搬得安全：
   *   · 只移动，不删除、不覆盖（重名加后缀）
   *   · 目标固定在 素材/ 下，不接受任意路径 —— 防止一个坏计划把文件扔到库外
   */
  ipcMain.handle('wiki:archive', (_e, items: ArchiveItem[]) => {
    const root = wikiPath()
    if (!root) return { ok: false, error: '还没设置知识库位置' }
    const ym = new Date().toISOString().slice(0, 7)
    const destDir = path.join(root, '素材', ym)
    const moved: { from: string; to: string }[] = []
    const failed: { name: string; error: string }[] = []
    try {
      fs.mkdirSync(destDir, { recursive: true })
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
    for (const it of items ?? []) {
      const name = path.basename(String(it?.name ?? ''))
      if (!name) continue
      const src = path.join(root, INBOX, name)
      try {
        if (!fs.existsSync(src)) {
          failed.push({ name, error: '收件箱里没有这个文件' })
          continue
        }
        // 允许 agent 指定新名字，但只取 basename —— 不接受任何路径成分
        const want = path.basename(String(it.rename || name))
        const finalName = uniqueName(destDir, want)
        fs.renameSync(src, path.join(destDir, finalName))
        moved.push({ from: `${INBOX}/${name}`, to: `素材/${ym}/${finalName}` })
        // 逐字稿跟着走：它是这份素材的一部分，留在收件箱里会变成孤儿
        try {
          const tSrc = path.join(root, INBOX, TRANSCRIPTS, name + '.txt')
          if (fs.existsSync(tSrc)) {
            const tDir = path.join(destDir, '逐字稿')
            fs.mkdirSync(tDir, { recursive: true })
            fs.renameSync(tSrc, path.join(tDir, uniqueName(tDir, finalName + '.txt')))
          }
        } catch {
          /* 逐字稿搬不动不影响主文件已经归位 */
        }
      } catch (e) {
        failed.push({ name, error: e instanceof Error ? e.message : String(e) })
      }
    }
    return { ok: true, moved, failed, status: wikiStatus() }
  })

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
    // 记一笔「放入」次数：和 log.md 里的 query 次数一起构成「仓鼠窝判据」
    try {
      const cur = JSON.parse(fs.readFileSync(cfgFile(), 'utf8') || '{}') as Record<string, unknown>
      cur.added = Number(cur.added ?? 0) + done.length
      fs.writeFileSync(cfgFile(), JSON.stringify(cur, null, 2))
    } catch {
      /* 统计失败无所谓，不影响文件已经放进来 */
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
   * 全库搜索：标题 + summary + 正文。
   *
   * 不做索引、不做向量——按原文给的刻度，几百篇之内直接扫就够快，
   * 「省掉了整套 embedding RAG 基建」。真越过那个规模再接 qmd（本地混合搜索，
   * 同时提供 CLI 和 MCP server，agent 和界面都能用）。
   */
  ipcMain.handle('wiki:search', (_e, q: string, limit = 40): WikiHit[] => {
    const root = wikiPath()
    const query = String(q ?? '').trim().toLowerCase()
    if (!root || query.length < 1) return []
    const out: WikiHit[] = []
    for (const rel of walkNotes(root)) {
      if (out.length >= limit) break
      const title = path.basename(rel, path.extname(rel))
      let text = ''
      try {
        text = fs.readFileSync(path.join(root, rel), 'utf8')
      } catch {
        continue
      }
      const low = text.toLowerCase()
      const inTitle = title.toLowerCase().includes(query)
      const at = low.indexOf(query)
      if (!inTitle && at < 0) continue
      // 命中处的上下文：标题命中就给 summary，正文命中就给那一行
      let snippet = ''
      if (at >= 0) {
        const s0 = low.lastIndexOf('\n', at) + 1
        const e0 = low.indexOf('\n', at)
        snippet = text.slice(s0, e0 < 0 ? text.length : e0).trim().slice(0, 140)
        // 命中落在 front-matter 的字段行上时，把 `summary:` 这类前缀去掉——
        // 列表里显示 "summary: xxx" 是把实现细节漏给用户看
        snippet = snippet.replace(/^\w+:\s*/, '')
      } else {
        const m = /^summary:\s*(.+)$/m.exec(text)
        snippet = (m?.[1] ?? '').trim().slice(0, 140)
      }
      // 标题命中排前面：找笔记时通常是记得名字
      out.push({ file: rel, title, snippet, titleHit: inTitle })
    }
    out.sort((a, b) => Number(b.titleHit) - Number(a.titleHit))
    return out
  })

  /** 换位置：只改指向，**不搬文件也不删文件**——搬家的决定该由用户在访达里做 */
  ipcMain.handle('wiki:setPath', (_e, root: string) => {
    if (!root || !path.isAbsolute(root)) return { ok: false, error: '需要绝对路径' }
    setWikiPath(root)
    return { ok: true, status: wikiStatus() }
  })

  /**
   * 反向链接：谁引用了这一篇。
   * 全库扫一遍 [[链接]] —— 几百篇的规模下这点 IO 可以忽略，
   * 上千篇再谈索引缓存（那时候本来也该接 qmd 了）。
   */
  /**
   * 存逐字稿。
   *
   * 落点是**收件箱里的隐藏目录**，不是 wiki 正文区 —— 两个理由：
   *   1. 转录是「预处理」，按定的纪律它是自动跑的，而自动的部分不该往 wiki 里写东西
   *   2. 三万字逐字稿是中间产物不是知识，直接进知识库等于污染
   * 点号开头 → 访达里看不见、也不会被数进收件箱徽章。
   * 归档时它会跟着媒体文件一起搬进 素材/。
   */
  ipcMain.handle('wiki:saveTranscript', (_e, mediaName: string, text: string) => {
    const root = wikiPath()
    if (!root) return { ok: false, error: '还没设置知识库位置' }
    try {
      const dir = path.join(root, INBOX, TRANSCRIPTS)
      fs.mkdirSync(dir, { recursive: true })
      const f = path.join(dir, path.basename(String(mediaName)) + '.txt')
      fs.writeFileSync(f, text)
      return { ok: true, path: f, rel: path.relative(root, f) }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  /** 读某个收件箱条目的逐字稿（agent 归档时用它来写笔记） */
  ipcMain.handle('wiki:transcript', (_e, mediaName: string): string | null => {
    const root = wikiPath()
    if (!root) return null
    try {
      return fs.readFileSync(path.join(root, INBOX, TRANSCRIPTS, path.basename(String(mediaName)) + '.txt'), 'utf8')
    } catch {
      return null
    }
  })

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
