// AI 对话输入框的斜杠命令候选。
//
// 为什么需要它：终端里 CLI 自己有 TUI 补全，打 `/` 就出候选；**AI 对话窗口的输入框
// 是我们自己的**，打 `/` 什么都不会出现。用户 2026-08-20 的原话：
// 「AI会话窗口现在不支持显示所有的slash命令」。
//
// **这张表只收实测能用的。** headless（`-p --input-format stream-json`）下相当一部分
// 交互式命令是废的 —— `/help` `/status` `/memory` `/rewind` 一律回
// 「isn't available in this environment.」。把它们列进候选比不列更糟：
// 用户点一个，得到一句英文拒绝。完整实测记录见 .plans/slash-probe/findings.md。

export interface SlashCmd {
  /** 不带斜杠的名字 */
  name: string
  /** 一句话说清点下去会发生什么。**写「会得到什么」，不是复述命令名** */
  desc: string
  from: 'builtin' | 'skill' | 'file'
}

/** 内置命令：每一条都在 2026-08-20 的 headless 实测里确认过有响应。
 *
 *  没进来的和为什么：
 *  · `/help` `/status` `/memory` `/rewind` —— 实测回「isn't available in this environment」
 *  · `/agents` —— 命令还在，但上游把 wizard 删了，只会告诉你「直接说就行」
 *  · `/init` `/review` `/doctor` `/resume` `/config` —— **没测**（有副作用或会开长任务）。
 *    没测出来的不等于不可用，谁补测了谁往上加。 */
export const BUILTIN_SLASH: SlashCmd[] = [
  { name: 'compact', desc: '把前面的对话压成摘要，腾出上下文', from: 'builtin' },
  { name: 'context', desc: '这个会话的上下文用了多少、都花在哪了', from: 'builtin' },
  { name: 'cost', desc: '这个会话到现在花了多少', from: 'builtin' },
  { name: 'usage', desc: '订阅额度还剩多少、什么时候重置', from: 'builtin' },
  { name: 'mcp', desc: '哪些 MCP server 连上了', from: 'builtin' },
  { name: 'clear', desc: '清空上下文重新开始（**它不回任何话**，这是正常的）', from: 'builtin' },
  { name: 'model', desc: '换个模型', from: 'builtin' },
  { name: 'effort', desc: '调思考强度', from: 'builtin' }
]

/** 当前输入是不是正在打一条斜杠命令；是的话返回 `/` 后面那截（可能是空串）。
 *
 *  **只认开头的斜杠**：句子中间的 `/` 是路径（`src/main/x.ts`）或日期，
 *  在那里弹候选是纯打扰。有空格也不再算 —— `/model opus` 已经在填参数了。 */
export function slashQuery(text: string): string | null {
  if (!text.startsWith('/')) return null
  const rest = text.slice(1)
  if (/\s/.test(rest)) return null
  return rest
}

/** 按输入筛候选。
 *
 *  排序：前缀匹配的排在包含匹配前面（打 `co` 时 `compact` 该在 `context` 之类之前，
 *  而不是被一个只是名字里含 co 的 skill 顶掉）；同档内内置命令优先 ——
 *  内置的就那几个，skill 可能有几十个，让 skill 把它们挤出视野是不合理的。 */
export function matchSlash(query: string, all: readonly SlashCmd[]): SlashCmd[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...all]
  const scored: { c: SlashCmd; rank: number }[] = []
  for (const c of all) {
    const n = c.name.toLowerCase()
    if (n.startsWith(q)) scored.push({ c, rank: 0 })
    else if (n.includes(q)) scored.push({ c, rank: 1 })
  }
  return scored
    .sort((a, b) => a.rank - b.rank || (a.c.from === b.c.from ? 0 : a.c.from === 'builtin' ? -1 : 1))
    .map((x) => x.c)
}

/** 已装的 skill → 候选。
 *
 *  **命令名取目录名，不是 frontmatter 里的 `name`** —— 后者是给人看的标题
 *  （「设计路由」「Design Router」），带空格和中文，当不了命令；
 *  CLI 认的是目录名。
 *
 *  被临时禁用的要排除：面板上它们是置灰的，列进候选等于让人点一个不生效的东西。 */
export function skillsToCmds(
  list: readonly { path: string; name?: string; description?: string }[],
  disabledPaths: readonly string[] = []
): SlashCmd[] {
  const off = new Set(disabledPaths)
  const seen = new Set<string>()
  const out: SlashCmd[] = []
  for (const it of list) {
    if (!it?.path || off.has(it.path)) continue
    // 手写 basename：这个模块是 shared，渲染层也要用，不能 import node:path
    const dir = it.path.replace(/[/\\]+$/, '').split(/[/\\]/).pop() ?? ''
    const name = dir.trim()
    if (!name || /[\s/\\]/.test(name) || seen.has(name)) continue
    seen.add(name)
    const desc = (it.description ?? '').trim()
    out.push({
      name,
      // 描述太长会把候选行撑爆，截断留个尾巴。没有描述就退回一句大白话
      desc: desc ? (desc.length > 46 ? `${desc.slice(0, 46)}…` : desc) : '你装的 skill',
      from: 'skill'
    })
  }
  return out
}


// ── @ 文件引用 ────────────────────────────────────────────────────────
//
// 终端里打 `@` 能补全项目文件，这个输入框以前没有。跟斜杠候选是同一套 UI，
// 只换数据源：**最近改过的文件**（fs:recentFiles）。
// 不做全量索引 —— 想引用的多半就是刚动过的那几个，而全量索引在大仓库上
// 既慢又会把真正相关的那几个淹掉。

/** 光标（这里简化成「文本末尾」）前面正在打的 `@xxx`；不是的话返回 null。
 *
 *  **只认末尾**：句子中间已经打完的 `@src/a.ts` 不该再弹候选，
 *  那会在用户继续写下去的时候一直挡着。
 *  **前面必须是行首或空白**：`a@b.com` 里的 @ 是邮箱不是引用。 */
export function atQuery(text: string): string | null {
  const m = /(?:^|\s)@([^\s]*)$/.exec(text)
  return m ? m[1] : null
}

/** 把选中的文件补进去：只替换末尾那段 `@xxx`，前面写的字一个不动。 */
export function applyAtPick(text: string, rel: string): string {
  return text.replace(/(?:^|\s)@([^\s]*)$/, (whole) => {
    const lead = whole.startsWith('@') ? '' : whole[0]
    return `${lead}@${rel} `
  })
}

/** 最近文件 → 候选。`name` 存相对路径（那是要插进去的东西），
 *  `desc` 存文件名，让人在一堆长路径里一眼找到目标。 */
export function filesToCmds(
  files: readonly { rel: string; name: string }[]
): SlashCmd[] {
  const seen = new Set<string>()
  const out: SlashCmd[] = []
  for (const f of files) {
    const rel = (f.rel ?? '').trim()
    if (!rel || seen.has(rel)) continue
    seen.add(rel)
    out.push({ name: rel, desc: f.name ?? '', from: 'file' })
  }
  return out
}
