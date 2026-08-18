// 把 adapter 注册表与「这台机器上探测到的可用性」合成渲染层能用的 CliInfo 列表。
// 纯函数——探测本身（adapter.detect()）是 IO，由调用方（session.ts 的 IPC handler）
// 先跑完，再把结果按 { [id]: boolean } 的形状喂进来，这里只管合成，可测的就是这一层。

import type { CliAdapter, CliInfo } from '../../shared/agentChat.ts'

/** availability 按 adapter.id 查；判据精确是 `=== true`——缺失的 key、显式的 false、
 *  乃至任何非布尔的真值都算不可用（宁可少显示一个选项，也不要让用户选一个装不上的 CLI
 *  然后报错）。capabilities 原样透传，不挑字段重新拼装——UI 靠它整体决定渲染哪些控件。
 *
 *  approvalHook 同样原样透传（2026-08-17 全分支最终评审 I2/I3）：它跟 capabilities 是
 *  两件事——capabilities.approval 非空只说明"这个 CLI 有细粒度审批能力"，approvalHook
 *  才说明"实现方式是不是装 Claude 那份 PreToolUse hook 文件"。渲染层的询问卡片、
 *  工具栏 chip、卸载按钮三处都要判后者；在这个字段被带过来之前它们只能拿前者当替身，
 *  今天两个 adapter 恰好重合，第三个 CLI 一来就分叉（详见 shared/agentChat.ts 的注释）。
 *  用 `?? undefined` 而不是直接取值，是为了让"没声明"这一支在结构化克隆过 IPC 时
 *  稳定地是 undefined，而不是随 adapter 写法在 undefined / 缺字段之间摇摆。 */
/** 有 adapter 之外、但**值得让用户看见**的 CLI。
 *
 *  为什么要有这个清单：用户第一次打开软件时，会话面板该告诉他「这个软件支持哪些 CLI」，
 *  而不是只列出恰好已经装了的。dsh 更特殊 —— 它装了也不能用于会话（headless 只打印
 *  最终消息，写不出 adapter），但在终端里能用上全部 MCP 能力。把它藏起来，用户
 *  永远不知道有这条路；不加标注地列出来，用户会装完发现选不了。所以要**显示 + 标注**。 */
export interface TerminalOnlyCli {
  id: string
  displayName: string
  /** 一句话说明它能用在哪 —— 直接显示给用户看 */
  scopeNote: string
  installCmd: string
}

export function buildCliList(
  adapters: CliAdapter[],
  availability: Record<string, boolean>,
  /** 没装时预填进终端的安装命令，按 id 查。没有就不给「一键安装」 */
  installCmds: Record<string, string> = {},
  /** 仅终端可用的那些（排在有 adapter 的后面） */
  terminalOnly: TerminalOnlyCli[] = []
): CliInfo[] {
  const main: CliInfo[] = adapters.map((a) => {
    const available = availability[a.id] === true
    return {
      id: a.id,
      displayName: a.displayName,
      available,
      chatSupported: true,
      // 已装的不给安装命令 —— 免得界面上出现「已经装了还劝你装」
      installCmd: available ? undefined : installCmds[a.id],
      capabilities: a.capabilities,
      approvalHook: a.approvalHook ?? undefined
    }
  })
  const extra: CliInfo[] = terminalOnly.map((t) => {
    const available = availability[t.id] === true
    return {
      id: t.id,
      displayName: t.displayName,
      available,
      chatSupported: false,
      scopeNote: t.scopeNote,
      installCmd: available ? undefined : t.installCmd,
      // 不能用于会话 → 能力一律为空，UI 不会为它渲染任何模型/强度/审批控件。
      // **照 CliCapabilities 的真实字段填**，别凭印象编（contextUsage 是必填的）
      capabilities: { models: [], effortLevels: [], compact: false, contextUsage: false, approval: [], sandboxLevels: [] },
      approvalHook: undefined
    }
  })
  return [...main, ...extra]
}
