// 库内的约定文件：CLAUDE.md / AGENTS.md / README / index.md / log.md，以及建骨架。
//
// 这些是**写给 agent 看的规矩**，不是用户的笔记。单独成一块的理由：
// 它们整段是可再生的模板，靠 SCHEMA_MARK 的版本标记判断「这份是我们生成的、可以安全覆盖」；
// 混在 IPC 编排里的时候，每次想改一句措辞都要在几百行 handler 中间翻。
import fs from 'fs'
import path from 'path'

import { dirOf, inboxOf } from './paths'
import { customSchemaBody, customIndexMd, customReadmeText } from './customSchema'
import { libraryDirs, readTaxonomy, taxonomyState } from './taxonomy'

/** re-export：接口约定里「schema.ts 导出 customSchemaBody」——实现挪去 customSchema.ts
 *  是因为这个文件（schema.ts）import 了 ./paths，paths.ts 又引了 electron，
 *  node --test 加载不了；customSchema.ts 不碰 electron，真正的单测打在那边。 */
export { customSchemaBody }

// ── 初始化时写进去的内容 ─────────────────────────────────────────

/** 库内 schema。CLAUDE.md 和 AGENTS.md 内容相同 —— 两个 CLI 各自会自动读 cwd 的那一份。 */
// v4：改成 begin/end 围栏。
//
// v3 之前整个文件都是我们的模板，升级时**整份重写**。问题在于：这个文件开头就写着
// 「这个知识库怎么用」，用户很自然会在里面补自己的规矩（我的笔记风格、这个库的特殊约定…），
// 而那些内容会在下一次启动时被静默抹掉 —— 我们连他写过东西都不知道。
//
// 现在只有围栏**之内**属于我们，升级只换这一段；围栏之外用户写什么都原样留着。
// 这和 ~/.codex/AGENTS.md 那边的托管区是同一套做法。
const SCHEMA_BEGIN = '<!-- eas-term:wiki-schema:begin v4 -->'
const SCHEMA_END = '<!-- eas-term:wiki-schema:end -->'
/** v3 及更早的整份模板标记。见到它说明是老格式，要迁移（迁移前备份，因为可能夹带着用户的内容）。 */
const SCHEMA_MARK_LEGACY = 'eas-term:wiki-schema'

/** 这个库盘上实际的目录名。新库全英文，老库回落中文 —— 模板里一律用这里的值，
 *  绝不写死，否则老库会拿到一份指向不存在目录的说明。 */
export interface WikiDirNames {
  inbox: string
  me: string
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
    me: dirOf(root, 'me'),
    people: dirOf(root, 'people'),
    methods: dirOf(root, 'methods'),
    domains: dirOf(root, 'domains'),
    projects: dirOf(root, 'projects'),
    sources: dirOf(root, 'sources'),
    templates: dirOf(root, '_templates')
  }
}

/** 围栏内的托管正文（不含围栏标记本身）。 */
function schemaBody(d: WikiDirNames): string {
  return `# 这个知识库怎么用

你是这个知识库的维护者，不是通用助手。
用户负责搜集素材、提问题、判断价值；你负责整理、归档、交叉引用和记账。

## 目录

- \`${d.inbox}/\` 用户丢进来、还没整理的原始素材
- \`${d.me}/\` **关于用户本人**：画像、工作习惯、沉淀的方法论、反复强调的取舍标准。
  产出要署他名字、或者他问「我该怎么做」的时候，先读这里 —— 这是复用率最高的一块。
  注意和下面 \`${d.people}/\` 的区别：这里是**他自己**，那里是**他研究的别人**，别混。
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

/** 完整的约定文件：托管区 + 一句话告诉用户「围栏外面是你的地盘」。
 *  那句话很重要 —— 不写的话，用户看到满屏 AI 约定，不会想到自己也能往里加东西。 */
export function schemaText(d: WikiDirNames): string {
  return `${SCHEMA_BEGIN}
${schemaBody(d)}${SCHEMA_END}

<!-- 上面是 Eas-Term 维护的部分，软件升级时会整段替换。
     这一行以下随你写（本库的特殊约定、你的笔记习惯…），升级不会动。 -->
`
}

/** 升级一个已存在的约定文件。返回它到底被怎么处理了，好如实告诉用户。 */
function upgradeSchemaFile(p: string, root: string): 'updated' | 'migrated' | 'kept' {
  let cur: string
  try {
    cur = fs.readFileSync(p, 'utf8')
  } catch {
    return 'kept' // 读不了就当用户的，别动
  }
  const b = cur.indexOf(SCHEMA_BEGIN)
  const e = cur.indexOf(SCHEMA_END)

  // 新格式：只换围栏内那一段，围栏外的内容（用户自己写的）原样保留。
  // 新文本从 schemaTextFor 取（内置/自定义都走它，各自生成自己的一份），
  // 但 schemaTextFor 给的是带围栏的完整文档——直接拼进来会把围栏标记和
  // 「围栏外随你写」的说明重复一份，所以先用 fencedBody 只截出围栏内那一段。
  if (b !== -1 && e !== -1 && e > b) {
    const next = cur.slice(0, b) + SCHEMA_BEGIN + '\n' + fencedBody(schemaTextFor(root)) + cur.slice(e)
    if (next === cur) return 'kept'
    fs.writeFileSync(p, next)
    return 'updated'
  }

  // 老格式（v3 及更早）：整份都是我们的模板 —— 但用户很可能已经往里加过东西。
  // 迁移成新格式之前先备份，那些内容至少还找得回来。
  if (cur.includes(SCHEMA_MARK_LEGACY)) {
    try {
      fs.writeFileSync(p + '.eas-backup', cur)
    } catch {
      /* 备份失败就不迁移了 —— 宁可停在旧版约定，也不能不留退路地覆盖 */
      return 'kept'
    }
    fs.writeFileSync(p, schemaTextFor(root))
    return 'migrated'
  }

  // 没有任何标记 = 用户自己写的（比如把已有的 Obsidian 库指过来），一个字都不碰
  return 'kept'
}

/** 从 schemaText / schemaTextFor 生成的完整文档里，截出围栏之间那一段（不含两端标记本身）。
 *  upgradeSchemaFile 只想替换这一段，围栏外是用户的地盘，原样保留。 */
function fencedBody(text: string): string {
  const b = text.indexOf(SCHEMA_BEGIN)
  const e = text.indexOf(SCHEMA_END)
  if (b === -1 || e === -1 || e <= b) return text // 不会发生，防御性兜底
  return text.slice(b + SCHEMA_BEGIN.length + 1, e)
}

/** 库说明书的分流入口：有 `.eas-wiki.json` 走自定义那份，没有就走内置 —— 内置这条
 *  原样调用 schemaText，一个字符都不改（文件头已经解释过为什么）。initWiki 和
 *  upgradeSchemaFile 都改从这里取文本，不再各自判断走哪条路。
 *
 *  下面这段模板和 schemaText 里的长得几乎一样，是刻意重复、不是漏抽公共函数——
 *  schemaText 的正文被外部校验钉住了源文本哈希，任何重构都会改到它的字节内容。 */
export function schemaTextFor(root: string): string {
  const t = readTaxonomy(root)
  if (!t) return schemaText(dirNames(root)) // 内置：原样不动
  return `${SCHEMA_BEGIN}
${customSchemaBody(t.dirs)}${SCHEMA_END}

<!-- 上面是 Eas-Term 维护的部分，软件升级时会整段替换。
     这一行以下随你写（本库的特殊约定、你的笔记习惯…），升级不会动。 -->
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

/** index.md 的分流入口：有 `.eas-wiki.json` 走 customIndexMd，没有就原样调内置 indexMd ——
 *  内置这条一个字符不改（indexMd 本身的源文本被外部哈希钉住，理由同 schemaTextFor）。
 *
 *  这两份 index.md 不像 CLAUDE.md/AGENTS.md 那样有围栏升级机制：initWiki 只在文件
 *  不存在时才写 index.md，写错了不会在下次启动自愈，所以「第一次就生成对」格外重要——
 *  这正是这个分流入口存在的原因。 */
export function indexMdFor(root: string): string {
  const t = readTaxonomy(root)
  if (!t) return indexMd(dirNames(root)) // 内置：原样不动
  return customIndexMd(t.dirs)
}

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

/** START-HERE.md 的分流入口，逻辑与 indexMdFor 对称：有配置走 customReadmeText，
 *  没有就原样调内置 readmeText，内置这条一个字符不改。同样只在文件不存在时写、
 *  没有升级机制，第一次生成就必须对。 */
export function readmeTextFor(root: string): string {
  const t = readTaxonomy(root)
  if (!t) return readmeText(dirNames(root)) // 内置：原样不动
  return customReadmeText(t.dirs)
}

/** 建骨架。已存在的文件一律不覆盖 —— 允许用户把已有的 Obsidian 库直接指过来。
 *
 *  **配置坏了（`taxonomyState` 第三态）时原样返回，不建目录、不改任何说明书**——
 *  这是本函数的第一道检查，早于任何 `mkdirSync`/`writeFileSync`。理由见
 *  taxonomy.ts 的 TaxonomyState 注释：回落到内置分类会把这个自定义库的目录和
 *  说明书真的改写成内置形状，不可逆；宁可什么都不做，等用户把 `.eas-wiki.json`
 *  改好。`blocked` 字段让调用方（`wiki:init` handler、界面）知道发生了什么——
 *  界面那边最终读的是 `wikiStatus()` 的 `taxonomyState`/`taxonomyError`
 *  （每次都当场重新判定，不依赖这次调用的返回值缓存下来的结论）。 */
export function initWiki(root: string): { created: string[]; skipped: string[]; blocked?: string } {
  const state = taxonomyState(root)
  if (state.kind === 'broken') {
    console.warn(`[wiki] ${root} 的分类配置读不出来，跳过建骨架/改说明书：${state.error}`)
    return { created: [], skipped: [], blocked: state.error }
  }
  const created: string[] = []
  const skipped: string[] = []
  fs.mkdirSync(root, { recursive: true })
  // 用 dirOf 解析：老库里已经有中文目录时，它返回中文名 → 判定为已存在 → 跳过。
  // 直接按内置列表建的话，老库会被塞进第二套英文目录，变成 14 个目录两套并存。
  // 自定义库（有 .eas-wiki.json）libraryDirs 直接给配置里的目录名，resolve 不会被调用。
  for (const dir of libraryDirs(root, (k) => dirOf(root, k))) {
    const p = path.join(root, dir.name)
    if (fs.existsSync(p)) skipped.push(dir.name + '/')
    else {
      fs.mkdirSync(p, { recursive: true })
      created.push(dir.name + '/')
    }
  }
  // START-HERE.md 取代原来的「从这里开始.md」：文件名也不留中文和空格。
  // 老库里已经有中文版时不再建第二份 —— 同一份说明两个文件只会让人不知道该看哪个。
  const readmeName = fs.existsSync(path.join(root, '从这里开始.md')) ? '从这里开始.md' : 'START-HERE.md'
  // index.md / START-HERE.md 都走 xxxFor(root) 分流：自定义库要拿到自己配置的目录名，
  // 不然会生成一份写着 people/methods/domains/projects 的索引和写着 sources/ 的说明，
  // 而这两份又没有围栏升级机制（只在文件不存在时写），首次建错就永久停在错的版本上。
  const files: [string, string][] = [
    ['CLAUDE.md', schemaTextFor(root)],
    ['AGENTS.md', schemaTextFor(root)],
    ['index.md', indexMdFor(root)],
    ['log.md', LOG_MD],
    [readmeName, readmeTextFor(root)]
  ]
  for (const [name, body] of files) {
    const p = path.join(root, name)
    if (!fs.existsSync(p)) {
      fs.writeFileSync(p, body)
      created.push(name)
      continue
    }
    // 约定文件（CLAUDE.md / AGENTS.md）只升级围栏内那一段，围栏外是用户的地盘。
    // 不升级的话，老知识库会永远停在旧约定上——新加的工具它根本不知道。
    if (name === 'CLAUDE.md' || name === 'AGENTS.md') {
      const r = upgradeSchemaFile(p, root)
      if (r === 'updated') {
        created.push(name + '（约定已更新到新版）')
        continue
      }
      if (r === 'migrated') {
        created.push(name + '（已改成可自定义格式，旧内容备份在 .eas-backup）')
        continue
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
