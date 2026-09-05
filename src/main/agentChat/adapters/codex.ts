// Codex 的 adapter：只做能力声明 + 启动参数拼装，事件翻译在 codexEvents.ts。
//
// **Ruling 5 已裁定**：子项目 A 内走 `codex exec --json`，不是 `codex app-server`。
// app-server 原生带审批，但标着 experimental，摸清握手与消息格式需要另一个 spike，
// 不该阻塞内核落地。exec 模式做不了逐次审批——`capabilities.approval` 因此是**空数组**，
// 这不是漏填，是明确告诉 UI「这个 CLI 只有沙箱级权限，没有逐次审批卡片」。
// UI 据此自动退回显示 `sandboxLevels`，不需要为 Codex 写任何分支——
// 这正是能力声明机制存在的意义。
//
// 参数依据：docs/cli-headless-接口实测.md 「二、Codex」，2026-08-14 实测。
// - 不给 --sandbox 时 Codex 默认 read-only，写文件会被静默拒绝——所以 buildArgs
//   永远带上 --sandbox，缺省用 workspace-write。
// - 实测不给 `< /dev/null` 会卡在 `Reading additional input from stdin...`——这条事实现在
//   由 buildArgs 返回值里的 stdin 字段表达（见 shared/agentChat.ts 上 CliAdapter 的注释），
//   下面直接返回 'ignore'，不再靠下游记住这个怪癖。
//
// app-server 接上时：加一个新 adapter 分支（或给这个文件加 experimental 开关），
// 把 approval 改回非空——UI 一行都不用改。

import type { CliAdapter, StartOpts } from '../../../shared/agentChat.ts'
import { bindRole } from '../../../shared/roleBinding.ts'
import { detectByWhich } from './detect.ts'
import { createCodexTranslator } from '../codexEvents.ts'

const DEFAULT_SANDBOX = 'workspace-write'

export const codexAdapter: CliAdapter = {
  id: 'codex',
  displayName: 'Codex',

  capabilities: {
    models: [], // 由 -m 传任意模型名，不预设列表——不是没填，是设计如此
    // Codex 通过 -c model_reasoning_effort=<值> 传，只有三档（Claude 有五档）
    effortLevels: [
      { id: 'low', label: '低' },
      { id: 'medium', label: '中' },
      { id: 'high', label: '高' }
    ],
    compact: false, // Codex 无对等的 slash command
    contextUsage: true,
    // 空数组：exec 模式做不了逐次审批（见文件头）
    approval: [],
    sandboxLevels: [
      { id: 'read-only', label: '只读' },
      { id: 'workspace-write', label: '可改工作区' },
      { id: 'danger-full-access', label: '完全放开' }
    ]
  },

  // 没有 approvalHook 字段：exec 模式做不了逐次审批，不装任何 hook（见文件头）。
  // app-server 落地时它会声明 capabilities.approval:['exec']，但那不该被自动当成
  // "要装 Claude 的 hook 文件"——app-server 原生带审批协议，大概率完全不需要装
  // 任何 hook 文件；即便真的需要，那也会是一种全新的 approvalHook 取值，不是复用
  // 'claude-pretooluse'（2026-08-14 全分支评审 I6 第 2 点：capabilities.approval
  // 与 approvalHook 是两件不同的事，混成一个布尔正是 C1 那个 Critical 的根）。

  detect: detectByWhich('codex'),

  createTranslator: createCodexTranslator,

  buildArgs(opts: StartOpts): { bin: string; args: string[]; stdin: 'pipe' | 'ignore' } {
    const b = bindRole(opts.roleBounds, 'codex', { knownMcpServers: opts.knownMcpServers })
    // resumeId 存在时子命令是 `exec resume <id>`，否则是普通 `exec`
    const args: string[] = opts.resumeId ? ['exec', 'resume', opts.resumeId] : ['exec']
    // 角色的 write:false 是沙箱的唯一来源；其余维持默认（UI 上沙箱只展示不可选）
    args.push('--json', '--sandbox', b.codex.sandbox ?? opts.sandbox ?? DEFAULT_SANDBOX)
    if (opts.model) args.push('-m', opts.model)
    if (opts.effort) args.push('-c', `model_reasoning_effort=${opts.effort}`)
    // 角色契约。Codex 没有 --append-system-prompt，能用的是 -c instructions=
    //（2026-09-05 实测 instructions / developer_instructions / model_instructions_file 三个都生效，
    // 最后那个是整份替换不能用；维持 instructions）。**必须压成单行**：`-c` 的取值里带换行
    // 会把解析弄乱。这一段与终端那条路（CanvasAgentBar 的 buildCodexCmd）是同一个结论，
    // 那边多做一步去双引号是因为它还要再过一次 shell；这里是 execFile 的 argv，
    // 不经 shell，引号原样传反而更准。
    // ⚠️ -c 不校验键名（实测 bogus 键照常起会话）—— 键名写错静默无效，测试逐字断言。
    const contract = opts.roleContract?.trim().replace(/\s*\n\s*/g, ' ')
    if (contract) args.push('-c', `instructions=${contract}`)
    // 内置工具走 --disable <feature>，MCP 走 mcp_servers.<名>.enabled=false；
    // 工具级的 disabled_tools 键已被 0.147 接受但效果未验，阶段三再接。
    // --disable shell_tool 实测真能摘掉 shell；MCP server 名字必须真实存在
    //（bindRole 已按 knownMcpServers 过滤，不存在的名字 Codex 会拒绝启动）。
    for (const f of b.codex.disable) args.push('--disable', f)
    for (const n of b.codex.disableServers) args.push('-c', `mcp_servers.${n}.enabled=false`)
    // exec 模式的 prompt 是位置参数，不经 stdin 收——不关掉 stdin 会卡在
    // "Reading additional input from stdin..."（实测），必须是 'ignore'。
    return { bin: 'codex', args, stdin: 'ignore' }
  }
}
