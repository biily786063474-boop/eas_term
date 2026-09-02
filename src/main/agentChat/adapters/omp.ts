// omp（Oh My Pi）的 adapter：**只做能力声明**。
//
// 与 claude.ts / codex.ts 有一处根本不同：那两个的 `buildArgs()` 就是 spawn 的依据，
// 而 omp 走独立的 ACP 传输层，进程由 `omp/launch.ts` 组参数、`omp/transport.ts` 收发。
// 所以这个文件里没有任何「怎么起它」的知识 —— 那些在 `omp/` 底下，
// 这里只回答 UI 与会话层要问的：**它会什么、它属于哪一类**。
//
// ── 为什么排在注册表最后 ────────────────────────────────────────────────────
// 三条路都取「第一个可用的 CLI」：`AgentChatView.tsx:445` 的空态默认、
// `phone/provider.ts` 的手机端、团队派活。omp 是随包的、`available` 恒真 ——
// 放前面会让**只登了 Claude 的老用户**升级当天每个新会话都被换成 omp。
// 用户红线是「不影响 CC 和 codex 的任何方面」，那也包括「不许把他们的默认选择换掉」。
// 声明 `bundled: true` 让上层能按能力位避开它（而不是按 id），
// 顺序本身由 `adapters.test.ts` 的一条断言钉住。
import { existsSync } from 'node:fs'

import type { CliAdapter, HostPaths, StartOpts } from '../../../shared/agentChat.ts'
import { ompBinPathOrNull } from '../omp/paths.ts'

export const ompAdapter: CliAdapter = {
  id: 'omp',
  displayName: 'Oh My Pi',

  // ── 能力位：下游按这些分流，**不许按 id 分流** ──────────────────────────
  /** 双向 JSON-RPC。`session.ts` 见到它就把这个会话整个交给 transport，
   *  既不走 `feed()`（那里假定翻译器只回事件数组）也不走 `writeStdin()`（那是 Claude 的行格式） */
  transport: 'acp',
  /** 靠 provider key 起会话，不是 CLI 自己的登录态。
   *  界面据此走独立的设置面板 —— `cliAuth` 那套（含 `CliLoginPanel`）只认 claude/codex，
   *  把 omp 送进去会在主进程直接抛（`STATUS_ARGS['omp']` 是 undefined）。 */
  auth: 'provider-key',
  bundled: true,
  /** 额度走短命的 `omp usage --json` 进程，不是事件流也不是 Claude 那条直连接口 */
  quotaSource: 'omp-usage',
  /** 会话内改模型 / 强度走 `session/set_config_option`，不重启、不丢上下文 */
  paramChange: 'acp-config',

  capabilities: {
    // **两个都留空是有意的**：omp 的可选模型是「provider × model」的动态组合，
    // 换个 provider 整份都不一样 —— 静态清单装不下。真正的清单由会话建立时的
    // `{k:'capabilities'}` 事件带过来覆盖（`fromConfigOptions`）。
    models: [],
    effortLevels: [],
    // omp 的 available_commands 里没有 compact。声明 'native' 的后果不是「按钮没反应」：
    // `deliverMessage` 会**先推 turn.start** 再投递，而拦下来只推一条非致命 error
    // 收不掉那一轮 —— 用户按一次压缩，界面永远转下去。
    compact: false,
    contextUsage: true,
    // 逐次审批走 ACP 的双通道（request_permission ＋ elicitation/create）。
    // 非空所以 UI 不会退回显示沙箱级别，也就不需要 sandboxLevels。
    approval: ['exec', 'patch', 'tool']
  },

  // 没有 `approvalHook`：不装 Claude 那份 PreToolUse hook 文件。
  // 它与 `capabilities.approval` 是两件事 —— 前者说「用哪种机制」，后者说「有没有这个能力」
  // （`shared/agentChat.ts` 那段注释记着把两者混成一个布尔造成过的事故）。
  // 声明了的后果不只是白写一个文件：`toolbarModel.ts` 会在 omp 的工具栏上摆出
  // Claude 的 hook 状态与「卸载」按钮。

  /** `host` 为空时**返回 false 而不是抛** —— `adapters.test.ts` 会对每个 adapter
   *  无参调 `detect()`，而 `process.resourcesPath` 在 `node --test` 下是 undefined。 */
  async detect(host?: HostPaths): Promise<boolean> {
    const bin = ompBinPathOrNull(host)
    return !!bin && existsSync(bin)
  },

  /** 占位。**omp 的事件翻译不走这条路** —— 真正的翻译器活在
   *  `omp/transport.ts` 里（它要产 `{events, reply}`，与本接口的 `ChatEvent[]` 不同型，
   *  而 `feed()` 会把返回值直接拿去 for-of）。
   *  留这个空实现只为满足 `CliAdapter` 契约与 `adapters.test.ts` 的形状检查；
   *  它**永远不会被调用**，因为 `session.ts` 见到 `transport:'acp'` 就已经分流走了。 */
  createTranslator() {
    return { push: () => [] }
  },

  /** 同样是占位。omp 的启动参数由 `omp/launch.ts` 的 `planOmpLaunch()` 组装 ——
   *  它要密钥柜与 MCP 桥，而 adapter 必须能在纯 node 下被单测加载。
   *
   *  **`mcpConfigPath` 不是被丢掉了**：transport 会把同一份配置转成
   *  `session/new` 的 `mcpServers` 参数（ACP 在握手里收，不在命令行里收）。
   *  `adapters.test.ts` 有一条断言锁住这个语义，免得「不带」被后人固化成「丢掉」。 */
  buildArgs(_opts: StartOpts): { bin: string; args: string[]; stdin: 'pipe' | 'ignore' } {
    return { bin: 'omp', args: ['acp'], stdin: 'pipe' }
  }
}
