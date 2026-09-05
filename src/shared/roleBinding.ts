// 角色能力意图 → 三个 harness 各自的参数。**纯函数、零依赖、node --test 裸跑。**
//
// 一条硬规矩：报告是绑定的副产物。每往某家的参数里放一样东西，就 push 一条 BindingLine；
// 编辑器里那段「粒度差异」将来从这里渲染，不再手写 —— 手写的说明已经落后过代码一次
//（编辑器曾写「Codex 没有工具级开关」，而 2026-09-05 实测 --disable shell_tool 真能摘掉 shell）。
import type { HarnessId, RoleCaps, RoleRaw } from './types'

export type Enforcement = 'hard' | 'soft' | 'degraded' | 'unsupported'
export type CapKey = 'write' | 'shell' | 'imageGen' | 'mcpServers' | 'mcpTools' | 'raw'

export interface BindingLine {
  cap: CapKey
  level: Enforcement
  /** 给人看的一句话：落成了什么参数、附注 */
  how: string
}

export interface RoleBounds {
  caps?: RoleCaps
  raw?: RoleRaw
}

export interface BindingContext {
  /** 本机实际配置的 MCP server 名。Codex 对不存在的名字会拒绝启动，所以有清单就按它过滤；
   *  通配 → server 名的降级匹配也靠它。不给 = 不过滤（调用方自己负责）。 */
  knownMcpServers?: readonly string[]
}

export interface RoleBinding {
  claude: { deny: string[] }
  codex: { disable: string[]; disableServers: string[]; sandbox: 'read-only' | undefined }
  omp: { removeTools: string[]; dropServers: string[]; dropServerPatterns: string[] }
  /** 只含 `kind` 那一家的行 */
  report: BindingLine[]
}

/** Claude 里「改文件」的三个内置工具 */
export const CLAUDE_WRITE_TOOLS = ['Write', 'Edit', 'NotebookEdit'] as const
/** omp 里「改文件」的三个内置工具（`OMP_TOOLS` 的子集） */
export const OMP_WRITE_TOOLS = ['write', 'edit', 'ast_edit'] as const
/** 图像类 MCP 的通配（原 roles.ts illustrator 那组，不带 mcp__ 前缀）。
 *  **黑名单**：用户装了没被覆盖到的生图 server，得自己填进 denyServers。 */
export const IMAGE_MCP_PATTERNS = ['*image*', '*dalle*', '*imagen*', '*flux*', '*banana*', '*midjourney*', '*stable*diffusion*'] as const

/** 只认 `*`，其余字符字面匹配，大小写不敏感 */
export function globMatch(pattern: string, name: string): boolean {
  const re = new RegExp('^' + pattern.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$', 'i')
  return re.test(name)
}

const uniq = (xs: string[]): string[] => [...new Set(xs)]

export function bindRole(bounds: RoleBounds | undefined, kind: HarnessId, ctx: BindingContext = {}): RoleBinding {
  const caps = bounds?.caps ?? {}
  const raw = bounds?.raw ?? {}
  const known = ctx.knownMcpServers
  const claudeDeny: string[] = []
  const codexDisable: string[] = []
  const codexServers: string[] = []
  let codexSandbox: 'read-only' | undefined
  const ompRemove: string[] = []
  const ompDrop: string[] = []
  const ompPatterns: string[] = []
  const report: BindingLine[] = []
  const line = (cap: CapKey, level: Enforcement, how: string): void => {
    report.push({ cap, level, how })
  }
  /** 通配匹配已知 server 名（Codex / omp 的降级路径） */
  const matchKnown = (patterns: readonly string[]): string[] =>
    (known ?? []).filter((n) => patterns.some((p) => globMatch(p, n)))

  if (caps.write === false) {
    const bashNote = caps.shell === false ? '' : '；Bash 未禁，模型仍可用命令改文件'
    if (kind === 'claude') {
      claudeDeny.push(...CLAUDE_WRITE_TOOLS)
      line('write', 'hard', `--disallowedTools ${CLAUDE_WRITE_TOOLS.join(' ')}${bashNote}`)
    } else if (kind === 'codex') {
      codexSandbox = 'read-only'
      line('write', 'hard', '-s read-only（OS 沙箱，连命令行写入一起挡）')
    } else {
      ompRemove.push(...OMP_WRITE_TOOLS)
      line('write', 'hard', `--tools 去掉 ${OMP_WRITE_TOOLS.join('/')}${bashNote.replace('Bash', 'bash')}`)
    }
  }

  if (caps.shell === false) {
    if (kind === 'claude') {
      claudeDeny.push('Bash')
      line('shell', 'hard', '--disallowedTools Bash')
    } else if (kind === 'codex') {
      codexDisable.push('shell_tool')
      line('shell', 'hard', '--disable shell_tool')
    } else {
      ompRemove.push('bash')
      line('shell', 'hard', '--tools 去掉 bash')
    }
  }

  if (caps.imageGen === false) {
    if (kind === 'claude') {
      claudeDeny.push(...IMAGE_MCP_PATTERNS.map((p) => `mcp__${p}`))
      line('imageGen', 'hard', `--disallowedTools ${IMAGE_MCP_PATTERNS.map((p) => `mcp__${p}`).join(' ')}`)
    } else if (kind === 'codex') {
      codexDisable.push('image_generation')
      const hit = matchKnown(IMAGE_MCP_PATTERNS)
      codexServers.push(...hit)
      line(
        'imageGen',
        'degraded',
        `--disable image_generation（2026-09-05 实测未摘掉内置生图，模型仍自称有 imagegen 工具，仅按名关 MCP server）：${hit.join(', ') || '无匹配'}`
      )
    } else {
      ompPatterns.push(...IMAGE_MCP_PATTERNS)
      line('imageGen', 'degraded', '无内置生图；图像类 MCP server 按名整个不连')
    }
  }

  const servers = caps.mcp?.denyServers ?? []
  if (servers.length) {
    if (kind === 'claude') {
      claudeDeny.push(...servers.map((n) => `mcp__${n}__*`))
      line('mcpServers', 'hard', servers.map((n) => `mcp__${n}__*`).join(' '))
    } else if (kind === 'codex') {
      const keep = known ? servers.filter((n) => known.includes(n)) : servers
      codexServers.push(...keep)
      line('mcpServers', 'hard', `-c mcp_servers.<名>.enabled=false：${keep.join(', ') || '（本机没有这些 server，跳过）'}`)
    } else {
      ompDrop.push(...servers)
      line('mcpServers', 'hard', `session/new 不连：${servers.join(', ')}`)
    }
  }

  const tools = caps.mcp?.denyTools ?? []
  if (tools.length) {
    if (kind === 'claude') {
      claudeDeny.push(...tools.map((p) => `mcp__${p}`))
      line('mcpTools', 'hard', tools.map((p) => `mcp__${p}`).join(' '))
    } else if (kind === 'codex') {
      const hit = matchKnown(tools)
      codexServers.push(...hit)
      line('mcpTools', 'degraded', `工具级通配降级为按 server 名整个关：${hit.join(', ') || '无匹配'}`)
    } else {
      ompPatterns.push(...tools)
      line('mcpTools', 'degraded', '工具级通配降级为按 server 名整个不连')
    }
  }

  if (kind === 'claude' && raw.claude?.deny?.length) {
    claudeDeny.push(...raw.claude.deny)
    line('raw', 'hard', `--disallowedTools ${raw.claude.deny.join(' ')}`)
  }
  if (kind === 'codex' && raw.codex?.disable?.length) {
    codexDisable.push(...raw.codex.disable)
    line('raw', 'hard', raw.codex.disable.map((f) => `--disable ${f}`).join(' '))
  }
  if (kind === 'omp' && raw.omp?.removeTools?.length) {
    ompRemove.push(...raw.omp.removeTools)
    line('raw', 'hard', `--tools 去掉 ${raw.omp.removeTools.join('/')}`)
  }

  return {
    claude: { deny: uniq(claudeDeny) },
    codex: { disable: uniq(codexDisable), disableServers: uniq(codexServers), sandbox: codexSandbox },
    omp: { removeTools: uniq(ompRemove), dropServers: uniq(ompDrop), dropServerPatterns: uniq(ompPatterns) },
    report
  }
}
