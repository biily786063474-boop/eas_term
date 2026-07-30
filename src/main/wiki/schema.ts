// 库内的约定文件：CLAUDE.md / AGENTS.md / README / index.md / log.md，以及建骨架。
//
// 这些是**写给 agent 看的规矩**，不是用户的笔记。单独成一块的理由：
// 它们整段是可再生的模板，靠 SCHEMA_MARK 的版本标记判断「这份是我们生成的、可以安全覆盖」；
// 混在 IPC 编排里的时候，每次想改一句措辞都要在几百行 handler 中间翻。
import fs from 'fs'
import path from 'path'

import { WIKI_DIRS, dirOf, inboxOf } from './paths'

// ── 初始化时写进去的内容 ─────────────────────────────────────────

/** 库内 schema。CLAUDE.md 和 AGENTS.md 内容相同 —— 两个 CLI 各自会自动读 cwd 的那一份。 */
/** 约定文件的版本标记。升级时靠它判断「这份是我们生成的」→ 可以安全覆盖；
 *  没有标记就是用户自己写的，一个字都不碰。 */
// v3：目录名改成全英文（老库仍用中文，模板按实际目录名生成）。
// 版本标记一变，已有库的 CLAUDE.md / AGENTS.md 会被重写成与自己目录名相符的那份 ——
// 这一步不能省：说明里的目录名和盘上不一致，agent 会去写不存在的路径。
const SCHEMA_MARK = '<!-- eas-term:wiki-schema v3 -->'

/** 这个库盘上实际的目录名。新库全英文，老库回落中文 —— 模板里一律用这里的值，
 *  绝不写死，否则老库会拿到一份指向不存在目录的说明。 */
export interface WikiDirNames {
  inbox: string
  people: string
  methods: string
  domains: string
  projects: string
  sources: string
  templates: string
}
export function dirNames(root: string): WikiDirNames {
  return {
    inbox: inboxOf(root),
    people: dirOf(root, 'people'),
    methods: dirOf(root, 'methods'),
    domains: dirOf(root, 'domains'),
    projects: dirOf(root, 'projects'),
    sources: dirOf(root, 'sources'),
    templates: dirOf(root, '_templates')
  }
}

export function schemaText(d: WikiDirNames): string {
  return `${SCHEMA_MARK}
# 这个知识库怎么用

你是这个知识库的维护者，不是通用助手。
用户负责搜集素材、提问题、判断价值；你负责整理、归档、交叉引用和记账。

## 目录

- \`${d.inbox}/\` 用户丢进来、还没整理的原始素材
- \`${d.people}/\` 博主 / 作者：思维模型、行为习惯、代表作、用户的实测反馈
- \`${d.methods}/\` 可迁移的做法（跨领域组织，不按学科切）
- \`${d.domains}/\` 编程 / 设计 / 剪辑 / 文案
- \`${d.projects}/\` 决策记录与复盘
- \`${d.sources}/\` 归档后的原件与逐字稿
- \`index.md\` 全库目录：每页一行链接 + 一句话摘要
- \`log.md\` 只追加的时间线

## 三条不可违反

1. **\`${d.sources}/\` 和 \`${d.inbox}/\` 里的原始文件只读。** 可以移动、可以重命名，
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
source: ${d.sources}/2026-07/xxx.mp4
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

/** 索引的分区标题跟着实际目录名走：标题和目录对不上，agent 更新索引时会往错的分区塞 */
const indexMd = (d: WikiDirNames): string => `# 索引

全库目录。每页一行：链接 + 一句话摘要。**每次 ingest 后由 agent 更新。**
回答问题时先读这一页，再决定深入哪几篇——这样判断「要不要读」只花一个文件的钱。

## ${d.people}

## ${d.methods}

## ${d.domains}

## ${d.projects}
`

const LOG_MD = `# 日志

只追加。每条以 \`## [日期] 动作 | 标题\` 开头，方便 \`grep "^## \\[" log.md | tail -5\`。
`

export function readmeText(d: WikiDirNames): string {
  return `---
summary: 这个知识库怎么用（初始化时自动生成，可以随便改或删）
tags: [说明]
created: ${new Date().toISOString().slice(0, 10)}
---

# 从这里开始

## 你要做的只有两件事

1. **把东西丢进 \`${d.inbox}/\`** —— 视频、文章、截图、随手记的想法，什么都行，不用整理。
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

**\`${d.sources}/\` 和 \`${d.inbox}/\` 里的原件，agent 只读不改。**
它可以移动位置、可以重命名，但不会修改内容、不会删除。
那些是你的真相来源。

参考：[[index]]
`
}

/** 建骨架。已存在的文件一律不覆盖 —— 允许用户把已有的 Obsidian 库直接指过来。 */
export function initWiki(root: string): { created: string[]; skipped: string[] } {
  const created: string[] = []
  const skipped: string[] = []
  fs.mkdirSync(root, { recursive: true })
  // 用 dirOf 解析：老库里已经有中文目录时，它返回中文名 → 判定为已存在 → 跳过。
  // 直接按 WIKI_DIRS 建的话，老库会被塞进第二套英文目录，变成 14 个目录两套并存。
  for (const key of WIKI_DIRS) {
    const actual = dirOf(root, key)
    const p = path.join(root, actual)
    if (fs.existsSync(p)) skipped.push(actual + '/')
    else {
      fs.mkdirSync(p, { recursive: true })
      created.push(actual + '/')
    }
  }
  const d = dirNames(root)
  // START-HERE.md 取代原来的「从这里开始.md」：文件名也不留中文和空格。
  // 老库里已经有中文版时不再建第二份 —— 同一份说明两个文件只会让人不知道该看哪个。
  const readmeName = fs.existsSync(path.join(root, '从这里开始.md')) ? '从这里开始.md' : 'START-HERE.md'
  const files: [string, string][] = [
    ['CLAUDE.md', schemaText(d)],
    ['AGENTS.md', schemaText(d)],
    ['index.md', indexMd(d)],
    ['log.md', LOG_MD],
    [readmeName, readmeText(d)]
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
export function uniqueName(dir: string, name: string): string {
  const ext = path.extname(name)
  const base = name.slice(0, name.length - ext.length)
  let n = 1
  let out = name
  while (fs.existsSync(path.join(dir, out))) out = `${base}-${++n}${ext}`
  return out
}
