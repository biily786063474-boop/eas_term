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
import { bindRole, codexAddServerArgs, codexDisableServerArg, codexDisabledToolsArg, codexSkillsConfigArg } from '../../../shared/roleBinding.ts'
import { detectByWhich } from './detect.ts'
import { listCodexModels } from '../codexModels.ts'
import { createCodexTranslator } from '../codexEvents.ts'

const DEFAULT_SANDBOX = 'workspace-write'

export const codexAdapter: CliAdapter = {
  id: 'codex',
  displayName: 'Codex',

  capabilities: {
    models: [], // 由 -m 传任意模型名，不预设列表——不是没填，是设计如此
    // 未探到每模型档位时保留旧默认；动态 model/list 的 effortLevels 优先。
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

  /** 模型清单问 `codex app-server` 的 `model/list` 要（codexModels.ts 有原因）。
   *  探测失败返回 undefined；会话层保留缓存与可重试的目录状态。 */
  probeModels: (_host, options) => listCodexModels({ force: options?.force }),

  createTranslator: createCodexTranslator,

  buildArgs(opts: StartOpts): { bin: string; args: string[]; stdin: 'pipe' | 'ignore' } {
    const b = bindRole(opts.roleBounds, 'codex', { knownMcpServers: opts.knownMcpServers, codexHome: opts.codexHome })
    // resumeId 存在时子命令是 `exec resume <id>`，否则是普通 `exec`
    const args: string[] = ['exec']
    // 角色的 write:false 是沙箱的唯一来源；其余维持默认（UI 上沙箱只展示不可选）
    // --sandbox 属于 exec，必须放在 resume 子命令之前（0.147.0 实测）。
    args.push('--sandbox', b.codex.sandbox ?? opts.sandbox ?? DEFAULT_SANDBOX)
    if (opts.resumeId) args.push('resume', opts.resumeId)
    args.push('--json')
    // **必须带 --skip-git-repo-check**（2026-09-05 正式版事故：「codex 侧完全是坏的」）。
    // Codex 拒绝在非 git 目录里跑：`Not inside a trusted directory and --skip-git-repo-check
    // was not specified`，退出码 1、什么都不回 —— 用户的资料夹（自媒体/工作流程…）没有一个是
    // git 仓库，于是每条消息都是「CLI 进程退出（code 1）」。这个检查是 Codex 防「在错误目录里
    // 写文件」的护栏，而这里的 cwd 是用户在画布上明确选的项目，且已经套了 --sandbox。
    args.push('--skip-git-repo-check')
    if (opts.model) args.push('-m', opts.model)
    if (opts.effort) args.push('-c', `model_reasoning_effort=${opts.effort}`)
    // 角色契约 + 协同板快照。Codex 没有 --append-system-prompt，能用的是 -c instructions=
    //（2026-09-05 实测 instructions / developer_instructions / model_instructions_file 三个都生效，
    // 最后那个是整份替换不能用；维持 instructions）。**必须压成单行**：`-c` 的取值里带换行
    // 会把解析弄乱。这一段与终端那条路（CanvasAgentBar 的 buildCodexCmd）是同一个结论，
    // 那边多做一步去双引号是因为它还要再过一次 shell；这里是 execFile 的 argv，
    // 不经 shell，引号原样传反而更准。
    // ⚠️ -c 不校验键名（实测 bogus 键照常起会话）—— 键名写错静默无效，测试逐字断言。
    //
    // 板文（Task 3 的 StartOpts.boardText，起会话那一刻的快照）与契约拼进同一段——
    // Codex 只有这一个系统提示式的入口，没有第二条 flag 可用。**只有板没契约也要拼**：
    // 没角色不代表用户不想让模型看到协同板。两段先各自 trim 再拼，整段再压成单行，
    // 顺序与 filter(Boolean) 保证「只有一段」时不会留多余空格。
    const contract = [
      opts.roleContract?.trim(),
      opts.boardText?.trim() ? `协同板（起会话时的快照）：${opts.boardText.trim()}` : ''
    ]
      .filter(Boolean)
      .join(' ')
      .replace(/\s*\n\s*/g, ' ')
    if (contract) args.push('-c', `instructions=${contract}`)
    // 内置工具走 --disable <feature>，MCP 走 mcp_servers.<名>.enabled=false；
    // --disable shell_tool 实测真能摘掉 shell；MCP server 名字必须真实存在
    //（bindRole 已按 knownMcpServers 过滤，不存在的名字 Codex 会拒绝启动）。
    for (const f of b.codex.disable) args.push('--disable', f)
    for (const n of b.codex.disableServers) args.push('-c', codexDisableServerArg(n))
    // 阶段三第二项（2026-09-06 探针实测）：denyTools 里写得出确切工具名的条目
    //（`<server>__<tool>`，bindRole 已经分好类）落成 `mcp_servers.<名>.disabled_tools=[…]`，
    // 按工具名精确摘掉，不必再牺牲整个 server；通配条目仍走上面 disableServers 那条老路。
    // **按 server 名排序遍历**（2026-09-06 最终评审 Minor 6）：`bindRole` 生成报告那行
    // 已经 `.sort()` 过，这里若跟着 JS 对象键的插入顺序走，`-c` 的实际顺序会跟报告里
    // 念的顺序对不上——参数不会因此失效，但排查时两边一比就自相矛盾。
    for (const server of Object.keys(b.codex.disabledTools).sort()) {
      const arg = codexDisabledToolsArg(server, b.codex.disabledTools[server])
      if (arg) args.push('-c', arg)
    }
    // 摘系统 skill（如 imagegen）：只有 bindRole 判定 hard（拿到了 codexHome）才会有内容。
    // 守卫看 codexSkillsConfigArg 的返回值而不是 skillsOff.length——它内部对空数组
    // 返回空串（避免拼出「清空用户全部 skills.config」的合法参数），这里跟着它的约定走。
    const skillsArg = codexSkillsConfigArg(b.codex.skillsOff)
    if (skillsArg) args.push('-c', skillsArg)
    // 用户选的**自家插件**（电脑视野 / 看板…）。Claude 走 `--mcp-config`、omp 走 ACP 握手，
    // 只有 Codex 两条都不走 —— 它只读 `~/.codex/config.toml`，而那份里没有插件。
    // 不补这一段，插件在 Codex 底座上就是「面板开着、模型手里一个工具都没有」。
    // **排在角色那几条 `-c` 后面**：角色的 enabled=false / disabled_tools 是限制，
    // 顺序上后于「有哪些 server」更好读；Codex 的 `-c` 之间没有先后依赖，两种都能跑。
    if (opts.pluginMcp) for (const c of codexAddServerArgs(opts.pluginMcp)) args.push('-c', c)
    // exec 模式的 prompt 是位置参数，不经 stdin 收——不关掉 stdin 会卡在
    // "Reading additional input from stdin..."（实测），必须是 'ignore'。
    return { bin: 'codex', args, stdin: 'ignore' }
  }
}
