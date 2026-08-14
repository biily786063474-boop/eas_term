// Claude Code 的 adapter：只做两件事——声明这个 CLI 会什么（capabilities），
// 拼装启动它的命令行（buildArgs）。事件翻译在 claudeEvents.ts，审批登记在
// approvalRegistry.ts，两边都不在这里重复。
//
// 参数依据：docs/cli-headless-接口实测.md 「一、Claude Code」，2026-08-14 实测，
// 版本 Claude Code 2.1.232。三条已验证过的硬约束（简报字面复述，别按旧印象改回去）：
// 1. --verbose 必须带——不带 stream-json 不完整。
// 2. 绝不能带 --bare——会跳过认证，返回 `Not logged in`。
// 3. 绝不能传 --permission-mode manual——那是直接拒绝，不是等待审批，会让审批卡片
//    永远等不到人。这里的做法是干脆不传 --permission-mode：审批走 PreToolUse hook
//    （项目级 .claude/settings.json 里配置的独立一条路），不依赖这个参数。
//
// -p 只是触发非交互「print 模式」的裸标志，不带参数——真正的用户输入通过
// --input-format stream-json 打开的 stdin 逐行写入（多轮会话靠同一个进程持续吃这些行），
// 不经过 buildArgs：StartOpts 里没有 prompt 字段，写 stdin 是上层（会话胶水层）的职责。

import { execFile } from 'node:child_process'
import type { CliAdapter, StartOpts } from '../../../shared/agentChat.ts'

/** 用 `which`（Windows 上是 `where`）判断 PATH 里有没有这个可执行文件。
 *  没选择跑 `claude --version`：那样会真的启动一次 CLI 进程，有版本检查/网络请求等
 *  副作用的风险，`which` 只查 PATH，快且没有副作用。 */
const WHICH_BIN = process.platform === 'win32' ? 'where' : 'which'

function detectByWhich(bin: string): () => Promise<boolean> {
  return () =>
    new Promise((resolve) => {
      execFile(WHICH_BIN, [bin], (err) => resolve(!err))
    })
}

export const claudeAdapter: CliAdapter = {
  id: 'claude',
  displayName: 'Claude Code',

  capabilities: {
    models: [
      { id: 'fable', label: 'Fable' },
      { id: 'opus', label: 'Opus' },
      { id: 'sonnet', label: 'Sonnet' },
      { id: 'haiku', label: 'Haiku' }
    ],
    // 实测 `claude --help`：low, medium, high, xhigh, max
    effortLevels: [
      { id: 'low', label: '低' },
      { id: 'medium', label: '中' },
      { id: 'high', label: '高' },
      { id: 'xhigh', label: '很高' },
      { id: 'max', label: '最高' }
    ],
    compact: 'slash',
    contextUsage: true,
    approval: ['exec', 'patch', 'tool']
  },

  detect: detectByWhich('claude'),

  buildArgs(opts: StartOpts): { bin: string; args: string[] } {
    const args = [
      '-p',
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--verbose',
      '--strict-mcp-config',
      '--include-hook-events',
      '--include-partial-messages'
    ]
    if (opts.model) args.push('--model', opts.model)
    if (opts.effort) args.push('--effort', opts.effort)
    if (opts.resumeId) args.push('--resume', opts.resumeId)
    return { bin: 'claude', args }
  }
}
