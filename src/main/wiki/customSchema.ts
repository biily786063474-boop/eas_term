// 自定义分类的库专用的说明书正文。
//
// 和 schema.ts 的 schemaBody 分开成两个文件是有意的：schemaBody 用八个具名字段拼出的
// 那份文字会被写进每一个内置库的 CLAUDE.md，一个字符都不能变；这份文字只服务
// 「自己定过 .eas-wiki.json」的库，按配置逐条列目录。两条路谁都不碰谁。
//
// **不 import electron，不 import ./paths、./schema** —— 这是它能被 `node --test`
// 直接加载的原因（schema.ts 因为 import 了 ./paths，而 paths.ts 引了 electron，
// node --test 加载 schema.ts 会在模块解析阶段就失败）。
import type { LibraryDir } from './taxonomy'

/** 自定义分类的库用这份说明书。**内置库不走这里** —— 那条路的文字一个字符都不能变，
 *  否则每个内置库的 CLAUDE.md 都会在下次启动时被重写成不同的内容。 */
export function customSchemaBody(dirs: LibraryDir[]): string {
  const lines = [
    '这个知识库的分类是你自己定的（见库根目录的 `.eas-wiki.json`）。',
    '',
    '## 往哪放',
    ''
  ]
  for (const d of dirs) lines.push(`- \`${d.name}/\` ${d.purpose}`)
  lines.push(
    '',
    '## 每篇都要有 front-matter',
    '',
    '`summary` 和 `tags` 是硬要求 —— 查询、图谱、体检全靠它们。',
    '',
    '```',
    '---',
    'summary: 一句话说清这篇讲什么',
    'tags: [标签1, 标签2]',
    '---',
    '```',
    '',
    '## 互相引用用 `[[双链]]`',
    '',
    '写 `[[笔记名]]` 就建立了关联，图谱和反链都靠它。'
  )
  return lines.join('\n')
}

/** 自定义分类的库用这份 index.md。**内置库不走这里**，规则与 schema.ts 的 indexMd 完全对应：
 *  内置版只给 people/methods/domains/projects 开分区（排除 inbox、me、sources(raw)、_templates）；
 *  自定义分类里没有「me」这种专门角色，能用的信号只有 role，等价规则就是排除
 *  role 为 inbox/raw/templates 的目录，剩下的按配置顺序逐个开一个 `## <name>` 分区。 */
export function customIndexMd(dirs: LibraryDir[]): string {
  const sections = dirs.filter((d) => d.role !== 'inbox' && d.role !== 'raw' && d.role !== 'templates')
  const lines = [
    '# 索引',
    '',
    '全库目录。每页一行：链接 + 一句话摘要。**每次 ingest 后由 agent 更新。**',
    '回答问题时先读这一页，再决定深入哪几篇——这样判断「要不要读」只花一个文件的钱。'
  ]
  for (const d of sections) lines.push('', `## ${d.name}`)
  lines.push('')
  return lines.join('\n')
}

/** 中文顿号 + "和" 列举：0 项给空串，1 项原样给，2 项以上前面用顿号分隔、最后一项前用"和"。
 *  customReadmeText 的「只读不改」那句要列的目录数量随配置变化（1 个 inbox + 0～N 个 raw），
 *  这里保证任何数量下都读得通，不会因为凑空位出现空的反引号对。 */
function joinCN(items: string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return items.slice(0, -1).join('、') + ' 和 ' + items[items.length - 1]
}

/** 自定义分类的库用这份 START-HERE.md。**内置库不走这里**，与 schema.ts 的 readmeText 对应：
 *  - 「把东西丢进 xxx/」取配置里 role:"inbox" 的那个目录名（校验已保证恰好一个）；
 *  - 「只读不改」那句列出所有 role 为 inbox 或 raw 的目录（raw 数量不定，可能是 0 个），
 *    用 joinCN 保证只有 inbox、没有 raw 时不会读出空目录名。
 *  其余段落（为什么不是搜索、三个动作表格、参考链接）和分类无关，原样照抄内置版。 */
export function customReadmeText(dirs: LibraryDir[]): string {
  const inboxName = dirs.find((d) => d.role === 'inbox')?.name ?? ''
  const rawNames = dirs.filter((d) => d.role === 'raw').map((d) => d.name)
  const readOnlyDirs = [...rawNames, inboxName].filter(Boolean)
  const readOnlyText = joinCN(readOnlyDirs.map((n) => `\`${n}/\``))
  return `---
summary: 这个知识库怎么用（初始化时自动生成，可以随便改或删）
tags: [说明]
created: ${new Date().toISOString().slice(0, 10)}
---

# 从这里开始

## 你要做的只有两件事

1. **把东西丢进 \`${inboxName}/\`** —— 视频、文章、截图、随手记的想法，什么都行，不用整理。
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

**${readOnlyText} 里的原件，agent 只读不改。**
它可以移动位置、可以重命名，但不会修改内容、不会删除。
那些是你的真相来源。

参考：[[index]]
`
}
