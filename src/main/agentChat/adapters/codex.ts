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
// - 实测不给 `< /dev/null` 会卡在 `Reading additional input from stdin...`。
//   这件事在这个 adapter 的接口里放不下：CliAdapter.buildArgs 只返回
//   `{ bin, args }`，没有 stdio 配置的位置——留给后续把这个 adapter 接到真实
//   spawn 的那一层去处理（把 Codex 子进程的 stdin 设成 'ignore' 或接 /dev/null），
//   这里只是留一条注释别让人忘掉。
//
// app-server 接上时：加一个新 adapter 分支（或给这个文件加 experimental 开关），
// 把 approval 改回非空——UI 一行都不用改。

import { execFile } from 'node:child_process'
import type { CliAdapter, StartOpts } from '../../../shared/agentChat.ts'

const WHICH_BIN = process.platform === 'win32' ? 'where' : 'which'

function detectByWhich(bin: string): () => Promise<boolean> {
  return () =>
    new Promise((resolve) => {
      execFile(WHICH_BIN, [bin], (err) => resolve(!err))
    })
}

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

  detect: detectByWhich('codex'),

  buildArgs(opts: StartOpts): { bin: string; args: string[] } {
    // resumeId 存在时子命令是 `exec resume <id>`，否则是普通 `exec`
    const args: string[] = opts.resumeId ? ['exec', 'resume', opts.resumeId] : ['exec']
    args.push('--json', '--sandbox', opts.sandbox ?? DEFAULT_SANDBOX)
    if (opts.model) args.push('-m', opts.model)
    if (opts.effort) args.push('-c', `model_reasoning_effort=${opts.effort}`)
    return { bin: 'codex', args }
  }
}
