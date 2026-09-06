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
  /** Codex 的配置目录（`CODEX_HOME` 或 `~/.codex`），由调用方算好传入 ——
   *  纯函数不读环境变量、不摸文件系统。摘系统 skill 要拼它的绝对路径（见 imageGen 分支）；
   *  不给就摘不掉，档位维持 degraded。渲染层的 RolePicker / CanvasRoleEditor 现在经 IPC
   *  `agent:codexHome` 也拿得到；拿不到的只剩终端命令条 `CanvasAgentBar` 那条已下线路径。 */
  codexHome?: string
  /** 阶段三第三项：**这条路径会附 Claude 的 PreToolUse 写守卫**（`--settings` 附
   *  `eas-write-guard.mjs`，补 `--disallowedTools` 挡不住 Bash 的洞）。由调用方声明，
   *  纯函数自己判断不了「这次真的会不会附」——那要看 `session.ts` 起会话时算出的
   *  `writeGuardSettings` 是否非空，`bindRole` 拿不到、也不该拿到那个决定过程。
   *
   *  两条路径的取值不同：对话会话（`AgentChatView` 经 `adapters/claude.ts`）传
   *  `!!opts.writeGuardSettings`，与这次真实拼出来的 `--settings` 是否存在保持一致；
   *  休眠的终端命令条（`CanvasAgentBar`，2026-09-03 起已下线 UI 入口）从不走
   *  `--settings` 这条机制，固定传 `false`（或不传，效果一样）——它拼命令是给用户在
   *  终端里自己跑的裸 `claude` 调用，没有任何东西会给它生成/附加这份 `--settings` 文件。
   *  渲染层的 `RolePicker` / `CanvasRoleEditor` 展示的是"如果开对话会话会怎样"的预览，
   *  按对话会话的口径传 `true`。 */
  claudeWriteGuard?: boolean
}

export interface RoleBinding {
  claude: { deny: string[] }
  codex: {
    disable: string[]
    disableServers: string[]
    /** 阶段三第二项：server → 工具名数组（已排序去重），落成 `-c mcp_servers.<名>.disabled_tools=[…]`。
     *  只收 `caps.mcp.denyTools` 里形如 `<server>__<tool>` 的精确条目——通配条目仍走
     *  `disableServers` 那条按 server 名整个关的降级老路（见 bindRole 里 mcp.denyTools 分支）。 */
    disabledTools: Record<string, string[]>
    skillsOff: string[]
    sandbox: 'read-only' | undefined
  }
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

/** Codex 关掉某个 MCP server 的 `-c` 取值字面量：`mcp_servers.<名>.enabled=false`。
 *  收口成一个函数是因为它原来在两处各手写一份（`adapters/codex.ts` 的无头启动路径、
 *  `CanvasAgentBar.tsx` 拼终端命令那条路径）——两处都要拼 `-c`，值只此一种写法，
 *  改一处忘了另一处的话，终端里跑起来的角色护栏会比无头模式松一截，且没有测试能拦。 */
export function codexDisableServerArg(name: string): string {
  return `mcp_servers.${name}.enabled=false`
}

/** Codex 按路径禁用系统 skill 的 `-c` 取值：TOML 内联表数组，逐字实测过 —— 路径必须是
 *  `SKILL.md` 文件的完整路径，写目录无效。路径里的 `\` 与 `"` 要转义（先转 `\`，
 *  否则会把转义 `"` 新加的反斜杠自己又转义一遍）。零依赖：不引任何 TOML 库。 */
export function codexSkillsConfigArg(paths: string[]): string {
  // 空数组不该生成 `skills.config=[]`——那是一句合法的 TOML，含义是「清空用户 config.toml
  // 里已经写的全部 skills.config」，跟「这个角色没有要摘的 skill」完全是两回事。调用方靠
  // 空串判断要不要拼这个 `-c`（见 adapters/codex.ts、CanvasAgentBar.tsx 的 `if (arg)` 守卫）。
  if (!paths.length) return ''
  const esc = (p: string): string => p.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  return `skills.config=[${paths.map((p) => `{path="${esc(p)}",enabled=false}`).join(',')}]`
}

/** Codex 按工具名精确摘掉 MCP 工具的 `-c` 取值：`mcp_servers.<名>.disabled_tools=[…]`
 *  （TOML 数组）。2026-09-06 阶段三第二项探针实测：这个键真把指定工具从模型的工具搜索
 *  结果里拿掉（判据是延迟工具搜索，不是问模型），Codex 给它的名字是 `mcp__<server>.<tool>`
 *  （点号分隔，不是 Claude 那种双下划线）。转义规则同 `codexSkillsConfigArg`（先转 `\`
 *  再转 `"`，否则会把转义 `"` 新加的反斜杠自己又转义一遍）；空数组返回空串，
 *  同 `codexSkillsConfigArg` 的约定——调用方靠这个决定要不要拼这个 `-c`。 */
export function codexDisabledToolsArg(server: string, tools: string[]): string {
  if (!tools.length) return ''
  const esc = (s: string): string => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  return `mcp_servers.${server}.disabled_tools=[${tools.map((t) => `"${esc(t)}"`).join(',')}]`
}

/** `caps.mcp.denyTools` 里能升成 Codex 精确 `disabled_tools` 的条目形状：`<server>__<tool>`
 *  ——不含 `*`、正好一个 `__` 分隔、两段都非空。其余形状（含 `*`，或不是这个形状）
 *  维持原样，走通配降级为按 server 名整个关那条老路（见 bindRole 里 mcp.denyTools 分支）。 */
function parsePreciseTool(entry: string): { server: string; tool: string } | null {
  if (entry.includes('*')) return null
  const parts = entry.split('__')
  if (parts.length !== 2) return null
  const [server, tool] = parts
  if (!server || !tool) return null
  return { server, tool }
}

const uniq = (xs: string[]): string[] => [...new Set(xs)]

export function bindRole(bounds: RoleBounds | undefined, kind: HarnessId, ctx: BindingContext = {}): RoleBinding {
  const caps = bounds?.caps ?? {}
  const raw = bounds?.raw ?? {}
  const known = ctx.knownMcpServers
  const claudeDeny: string[] = []
  const codexDisable: string[] = []
  const codexServers: string[] = []
  const codexDisabledTools: Record<string, string[]> = {}
  const codexSkillsOff: string[] = []
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
      // 阶段三第三项：这条路径附没附 PreToolUse 写守卫（--settings 补的第二道闸），
      // 由调用方经 ctx.claudeWriteGuard 声明——纯函数自己判断不了「这次真的会不会附」。
      // 额外守一手 `caps.shell !== false`：shell 已经整个禁掉时 --disallowedTools Bash
      // 已经挡死了命令行，守卫是死重量，不该在报告里说「附了」误导人以为多了一层保护——
      // 真实的 session.ts 起会话时本就不会在这个组合下生成 writeGuardSettings（同一个判据），
      // 这里再判一次是为了让 bindRole 自己也自洽，不依赖调用方传值精确。
      const guardActive = ctx.claudeWriteGuard === true && caps.shell !== false
      const how = guardActive
        ? `--disallowedTools ${CLAUDE_WRITE_TOOLS.join(' ')} + PreToolUse 守卫拦 Bash 里的写命令（按命令模式：重定向、tee、sed -i、rm/mv/cp/mkdir/touch、git 写操作、包管理安装；脚本文件里的写操作拦不住）`
        : `--disallowedTools ${CLAUDE_WRITE_TOOLS.join(' ')}${bashNote}`
      line('write', 'hard', how)
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
      // 2026-09-06 阶段三探针（本机 Codex 0.147.0，三种鉴权模式都测过）：内置 `image_gen`
      // 工具从未进过模型的工具清单，`--disable image_generation` 前后 tools 清单完全一致；
      // 这条 --disable 仍然保留，因为 feature 的 effective state 确实被它扳成了 false
      // （`codex features list` 可核），万一未来版本真的接了内置生图，这条不会白留。
      // 模型嘴上说的「imagegen 工具」，实测是系统 skill
      // `$CODEX_HOME/skills/.system/imagegen/SKILL.md`（请求体 `### Available skills` 段列着它，
      // 教模型优先用内置 image_gen、兜底跑 `scripts/image_gen.py`）。按 SKILL.md 的完整路径
      // 禁用它（`skills.config=[{path=...,enabled=false}]`，写目录无效，实测过）才是真正摘掉
      // 生图能力的那一步，档位因此升到 hard。调用方给不出 codexHome（现在只剩终端命令条
      // `CanvasAgentBar` 那条已下线路径——它自己的注释写明故意不传 codexHome；对话节点与
      // 渲染层的 RolePicker / CanvasRoleEditor 都已能经 IPC 拿到）时摘不掉 skill，
      // 档位退回 degraded，如实告知而不是假装摘了。
      // 残余逃生口：子进程环境若带 OPENAI_API_KEY（终端起的 app 会继承外部 shell 的环境变量），
      // 模型仍可能手动跑 image_gen.py ——这与「write:false 留着 Bash 仍能改文件」同一类逃生口，
      // 只在报告里如实注明，不因此改判定档位。
      codexDisable.push('image_generation')
      const hit = matchKnown(IMAGE_MCP_PATTERNS)
      codexServers.push(...hit)
      const serverNote = `按名关掉 MCP server：${hit.join(', ') || '无匹配'}`
      const residualNote = '若环境有 OPENAI_API_KEY，skill 的 CLI 兜底仍可被手动跑'
      if (ctx.codexHome) {
        // `-c skills.config=[...]` 是整体覆盖用户 config.toml 里的 skills.config，不是追加——
        // 如果用户自己也手写了这个键，这条会把它整个盖掉。没做读用户配置合并（会引入 TOML
        // 解析与合并冲突的复杂度，阶段三不做），如实在 how 里告知。
        // Windows 上 codexHome 可能是反斜杠路径（如 `C:\Users\x\.codex`），拼路径时跟着
        // codexHome 自己用的分隔符走，不写死 `/`——两种分隔符混用在 Windows 上未实测过
        // codex 是否照样能读。
        const sep = ctx.codexHome.includes('\\') ? '\\' : '/'
        codexSkillsOff.push([ctx.codexHome, 'skills', '.system', 'imagegen', 'SKILL.md'].join(sep))
        line(
          'imageGen',
          'hard',
          `--disable image_generation（feature 生效状态实测为 false；本机内置 image_gen 本就不在工具清单）` +
            `+ 摘掉 imagegen 系统 skill（skills.config 按 SKILL.md 路径禁用）；${serverNote}；${residualNote}` +
            `；注意这会整体覆盖你 config.toml 里自己写的 skills.config`
        )
      } else {
        line(
          'imageGen',
          'degraded',
          `--disable image_generation（feature 生效状态实测为 false；本机内置 image_gen 本就不在工具清单）；` +
            `${serverNote}；未摘掉 imagegen 系统 skill（这条路径拿不到 Codex 配置目录）；${residualNote}`
        )
      }
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
      // 阶段三第二项（2026-09-06 探针）：先把「写得出确切工具名」的条目（形如
      // `<server>__<tool>`，不含 `*`）分出来，能升 hard；剩下的（含 `*`，或不是这个
      // 形状）维持原样走通配降级。两类都有内容时各出一条报告行——这正是下面这份测试
      // 计数要跟着这次改动调整的原因（roleBinding.test.ts 有专门的两行报告断言）。
      const precise: Array<{ server: string; tool: string }> = []
      const rest: string[] = []
      for (const t of tools) {
        const p = parsePreciseTool(t)
        if (p) precise.push(p)
        else rest.push(t)
      }
      if (precise.length) {
        const dropped = new Set<string>()
        for (const { server, tool } of precise) {
          if (known && !known.includes(server)) {
            dropped.add(server)
            continue
          }
          ;(codexDisabledTools[server] ??= []).push(tool)
        }
        for (const s of Object.keys(codexDisabledTools)) codexDisabledTools[s] = uniq(codexDisabledTools[s]).sort()
        const argsList = Object.entries(codexDisabledTools).map(([s, ts]) => codexDisabledToolsArg(s, ts))
        const summary = Object.entries(codexDisabledTools)
          .map(([s, ts]) => `${s}: ${ts.map((t) => `mcp__${s}.${t}`).join(', ')}`)
          .join('；')
        const droppedNote = dropped.size ? `；本机没有这些 server，跳过：${[...dropped].join(', ')}` : ''
        const how = argsList.length
          ? `-c ${argsList.join(' -c ')}（按工具名精确摘掉；Codex 里叫 mcp__<server>.<tool>）：${summary}${droppedNote}`
          : `本机没有这些 server，跳过：${[...dropped].join(', ')}`
        line('mcpTools', 'hard', how)
      }
      if (rest.length) {
        const hit = matchKnown(rest)
        codexServers.push(...hit)
        line('mcpTools', 'degraded', `工具级通配降级为按 server 名整个关：${hit.join(', ') || '无匹配'}`)
      }
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
    codex: {
      disable: uniq(codexDisable),
      disableServers: uniq(codexServers),
      disabledTools: codexDisabledTools,
      skillsOff: uniq(codexSkillsOff),
      sandbox: codexSandbox
    },
    omp: { removeTools: uniq(ompRemove), dropServers: uniq(ompDrop), dropServerPatterns: uniq(ompPatterns) },
    report
  }
}

// ── 给界面用的标签与派生 ─────────────────────────────────────────────────────
// 这里只有**名词**（cap 叫什么、harness 叫什么、档位叫什么）。
// 「各家怎么落」那些句子仍然只由 bindRole 生成 —— 界面不许再手写它们。

export const HARNESSES: readonly HarnessId[] = ['claude', 'codex', 'omp']
export const HARNESS_LABEL: Record<HarnessId, string> = { claude: 'Claude', codex: 'Codex', omp: '默认 harness' }
export const CAP_LABEL: Record<CapKey, string> = {
  write: '不许改文件',
  shell: '不许跑命令',
  imageGen: '不许生图',
  mcpServers: '禁用的 MCP server',
  mcpTools: '禁用的 MCP 工具',
  raw: '手写参数'
}
export const LEVEL_LABEL: Record<Enforcement, string> = { hard: '硬', soft: '软', degraded: '降级', unsupported: '不支持' }

export interface MatrixRow {
  cap: CapKey
  /** 这一行在当前草稿里是否点亮。没点亮的三个意图行仍给出「点亮后会怎样」的预览 */
  active: boolean
  cells: Partial<Record<HarnessId, BindingLine>>
}

const INTENTS = ['write', 'shell', 'imageGen'] as const

/** 编辑器三列矩阵的数据。三个意图行永远在（未点亮的按「假设点亮」预览）；
 *  mcpServers / mcpTools / raw 只在草稿里真有内容时追加。 */
export function capMatrix(bounds: RoleBounds | undefined, ctx: BindingContext = {}): MatrixRow[] {
  const caps = bounds?.caps ?? {}
  const rows: MatrixRow[] = []
  for (const k of INTENTS) {
    const active = caps[k] === false
    const preview: RoleBounds = active ? (bounds ?? {}) : { ...bounds, caps: { ...caps, [k]: false } }
    const cells: MatrixRow['cells'] = {}
    for (const h of HARNESSES) {
      const line = bindRole(preview, h, ctx).report.find((l) => l.cap === k)
      if (line) cells[h] = line
    }
    rows.push({ cap: k, active, cells })
  }
  for (const k of ['mcpServers', 'mcpTools', 'raw'] as const) {
    const cells: MatrixRow['cells'] = {}
    for (const h of HARNESSES) {
      const line = bindRole(bounds, h, ctx).report.find((l) => l.cap === k)
      if (line) cells[h] = line
    }
    if (Object.keys(cells).length) rows.push({ cap: k, active: true, cells })
  }
  return rows
}

/** 工具栏降级标记用：这张卡在这家上哪些限制打了折扣 */
export function degradedLines(bounds: RoleBounds | undefined, kind: HarnessId, ctx: BindingContext = {}): BindingLine[] {
  return bindRole(bounds, kind, ctx).report.filter((l) => l.level === 'degraded' || l.level === 'unsupported')
}
