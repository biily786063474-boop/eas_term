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

import { ASK_FIRST_PROMPT, OUTPUT_STYLE_PROMPT } from '../../../shared/agentChat.ts'
import type { CliAdapter, StartOpts } from '../../../shared/agentChat.ts'
import { detectByWhich } from './detect.ts'
import { createClaudeTranslator } from '../claudeEvents.ts'

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

  // 逐次审批走 Claude Code 的 PreToolUse hook 机制——这是"用哪种审批机制"的声明，与
  // 上面 capabilities.approval("能不能弹审批卡片")是两件事（2026-08-14 全分支评审
  // I6 第 2 点，详见 shared/agentChat.ts 的 CliAdapter.approvalHook 注释）。
  approvalHook: 'claude-pretooluse',
  // 会话内改模型/effort 走 /model、/effort 命令（实测 headless 下同样生效），
  // 不必重启进程 —— 重启要冷启动数秒，还得靠 resume 把上下文接回来。
  paramChange: 'slash',

  detect: detectByWhich('claude'),

  createTranslator: createClaudeTranslator,

  buildArgs(opts: StartOpts): { bin: string; args: string[]; stdin: 'pipe' | 'ignore' } {
    const args = [
      '-p',
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--verbose',
      '--strict-mcp-config',
      '--include-hook-events',
      // 流式输出（2026-08-17 加回来）。它让 stdout 多出一路 stream_event 增量分块，
      // 每个 token 一行 JSON。**加它之前先把消费者写好了** —— claudeEvents.ts 的
      // translateStreamEvent 产出 text.delta，reduce.ts 攒成正在流的那个轮次。
      // 顺序反过来就是 2026-08-14 评审 I5 说的那个状态：flag 开着、事件全被 default
      // 分支静默丢弃，纯成本零收益。
      //
      // 用户视角的理由：不带它的话，从发出消息到第一段文字出现之间是完全静默的，
      // 长任务里人不知道软件到底在不在干活。
      '--include-partial-messages',
      // 输出格式约定（不用 emoji、标题最多三级、不用分隔线）。
      // **走系统提示而不是在用户消息后面加后缀**：不污染用户说的话、整段会话一直有效、
      // 只在 spawn 时传一次（还能吃到 prompt 缓存）。规范文本本身是共享的，
      // 见 shared/agentChat.ts 的 OUTPUT_STYLE_PROMPT。
      '--append-system-prompt',
      // 开了审批保护时，把「先问再做」一并附上（伪无头：不装 hook、不阻塞，
      // 让模型自己先说打算。取舍见 ASK_FIRST_PROMPT 的说明）。
      // 拼成一条而不是传两次 --append-system-prompt：那个 flag 传两次的行为
      // 没实测过，拼字符串是确定的。
      opts.askFirst ? `${OUTPUT_STYLE_PROMPT}\n\n${ASK_FIRST_PROMPT}` : OUTPUT_STYLE_PROMPT
    ]
    if (opts.model) args.push('--model', opts.model)
    if (opts.effort) args.push('--effort', opts.effort)
    if (opts.resumeId) args.push('--resume', opts.resumeId)
    // stdin 是送消息的活跃通道：--input-format stream-json 靠它逐行写用户消息，
    // 必须保持打开——绝不能是 'ignore'。
    return { bin: 'claude', args, stdin: 'pipe' }
  }
}
