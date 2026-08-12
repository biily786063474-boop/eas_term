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
