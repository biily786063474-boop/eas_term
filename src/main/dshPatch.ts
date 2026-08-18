// 往 DeepSeek Harness 的 `cordis.patch.yml` 里写/清我们那段 MCP 配置。
// 纯函数、零 import，node --test 直接跑。
//
// ── 为什么用围栏注释而不是解析 YAML ──────────────────────────────────
// 这个文件是**用户的 patch 层**（profile 目录里的注释原话：「Edit cordis.patch.yml,
// not this file」）。他可能往里写任意条目。整份解析再回写，等于把他手写的注释、
// 顺序、锚点全部按解析器的想法重排一遍 —— 和 mcpBridge 里 Codex 那段
// 「TOML 没有安全的通用回写路径」是同一个理由。
//
// 围栏注释只碰标记之间的行，围栏外一个字不动，语义和 AGENTS.md 托管区完全一致。
//
// ── 一个必须处理的边界 ──────────────────────────────────────────────
// 这个文件初始内容是 `[]`（空数组的 flow 写法）。直接在后面追加块序列条目
// （`- id: ...`）会让 YAML 解析失败 —— 同一个文档里既有 flow 空数组又有块序列。
// 所以剥掉围栏之后，如果剩下的实质内容只是 `[]`，要把它一并去掉。

export const DSH_BEGIN = '# eas-term:begin 由 Eas-Term 自动维护，勿手改；删掉整段即可移除'
export const DSH_END = '# eas-term:end'

export interface DshMcpEntry {
  /** 模型看到的工具名前缀：`mcp__<serverName>__<tool>` */
  serverName: string
  command: string
  args: string[]
  /** 要透传给 MCP server 子进程的环境变量名。**只传名字不传值** ——
   *  值用 dsh 的 `!!js process.env.X` 表达式在它那边现取，
   *  这样 token 不会落进任何配置文件（门禁的前提）。 */
  passEnv: string[]
}

const q = (v: string): string => JSON.stringify(v)

/** 生成我们那一段（含围栏）。一个 MCP server 一个插件实例，这是 dsh-mcp-client 的用法。 */
export function dshRegion(entries: DshMcpEntry[]): string {
  if (entries.length === 0) return ''
  const lines: string[] = [DSH_BEGIN]
  for (const e of entries) {
    lines.push(`- id: mcp-${e.serverName}`)
    lines.push(`  name: '@deepseek-ai/dsh-mcp-client'`)
    lines.push(`  config:`)
    lines.push(`    serverName: ${q(e.serverName)}`)
    lines.push(`    transport: stdio`)
    lines.push(`    command: ${q(e.command)}`)
    lines.push(`    args: [${e.args.map(q).join(', ')}]`)
    if (e.passEnv.length) {
      lines.push(`    env:`)
      // `!!js` 是 dsh 自己的表达式标签（见 dsh-mcp-client 的 README）。
      // 值在 dsh 进程里现取 —— 而 dsh 是被 Eas-Term 的 pty 起的，
      // 那份 env 里才有 token，别的终端起 dsh 取到的是空，工具自然连不上。
      for (const k of e.passEnv) lines.push(`      ${k}: !!js process.env.${k}`)
    }
  }
  lines.push(DSH_END)
  return lines.join('\n')
}

/** 把现有文件内容里我们那段替换成 `region`（空串 = 删掉）。围栏外原样保留。 */
export function applyDshPatch(raw: string, region: string): string {
  let body = raw
  const i = body.indexOf(DSH_BEGIN)
  const j = body.indexOf(DSH_END)
  if (i >= 0 && j > i) body = body.slice(0, i) + body.slice(j + DSH_END.length)

  // 判断剩下的实质内容：注释、空行不算
  const meaningful = body
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
  // 只剩一个空数组字面量 → 去掉它，否则和下面的块序列冲突，整个文件解析失败
  const onlyEmptyArray = meaningful.length === 1 && meaningful[0] === '[]'
  if (onlyEmptyArray) {
    body = body
      .split('\n')
      .filter((l) => l.trim() !== '[]')
      .join('\n')
  }

  body = body.replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '')
  if (!region) {
    // 清掉之后如果什么实质内容都不剩，把空数组还回去 —— 空文件不是合法的 patch 层
    const left = body.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    return left.length ? body + '\n' : (body ? body + '\n[]\n' : '[]\n')
  }
  return body ? `${body}\n\n${region}\n` : `${region}\n`
}
