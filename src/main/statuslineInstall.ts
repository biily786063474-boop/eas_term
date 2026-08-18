// 把 Eas-Term 的 statusline 转发器**包在**用户原有的 statusline 外面。纯函数、零 import。
//
// ── 为什么要碰这个配置 ────────────────────────────────────────────────
// 真实的订阅额度百分比、以及与 /context 口径一致的上下文占用，只在 statusline 的
// stdin 里（2026-08-18 实测，headless 事件流里没有）。要拿到它，只能让 Claude Code
// 把那份 JSON 喂给我们的进程。
//
// ── 铁律：包装，不是替换 ──────────────────────────────────────────────
// 用户很可能已经配了自己的 statusline（本机就配着 claude-hud，命令是一长串动态
// 找最新版本目录的 bash）。**直接改写 command 等于废掉他的状态栏。**
// 所以：把原命令原样存进 EAS_STATUSLINE_WRAPPED，我们的脚本转发 stdin 给它、
// 原样吐它的输出。卸载时把原命令放回去 —— 存的是**原文**，不是我们重新拼的。
//
// 用 `_easTerm` 标记认自己那一层，和 agentHook.ts 的 TAG 同一个套路：
// 没有标记就说明这层不是我们装的，绝不动它。

export const STATUSLINE_TAG = 'eas-term-statusline'

export interface StatusLineCfg {
  type?: string
  command?: string
  /** 我们装的标记。没有它 = 这层不是我们的 */
  _easTerm?: string
  /** 被我们包起来的原命令，卸载时原样放回 */
  _easWrapped?: string
  [k: string]: unknown
}

/** 我们这一层的命令。node 解释器与脚本路径由调用方给（要保证存在的绝对路径）。 */
export function wrapperCommand(nodeBin: string, scriptPath: string, wrapped: string): string {
  // 原命令经 env 传，不拼进命令行 —— 它可能包含引号、单引号、换行
  // （claude-hud 那条就有一堆嵌套引号），拼字符串必然拼坏
  return `EAS_STATUSLINE_WRAPPED=${shq(wrapped)} ${shq(nodeBin)} ${shq(scriptPath)}`
}

/** 单引号包裹 + 转义内部单引号。路径/命令里有空格、中文、引号都不会把命令拆散。 */
export function shq(v: string): string {
  return `'${v.replace(/'/g, "'\\''")}'`
}

export interface PlanResult {
  /** 要写回的配置；null = 不用改（已经是想要的样子） */
  next: StatusLineCfg | null
  /** 给日志/界面的一句话 */
  reason: string
}

/**
 * 规划安装。**幂等**：已经装过就不重复包（否则会包成套娃，每刷新一次多跑一层）。
 */
export function planInstall(cur: StatusLineCfg | null | undefined, wrapperCmd: string, originalCmd: string): PlanResult {
  const installed = cur?._easTerm === STATUSLINE_TAG
  if (installed) {
    // 已经是我们的一层。只有命令本身变了（app 升级换了脚本路径）才更新，
    // 且**保留原来存的 _easWrapped** —— 不能拿现在的 command（那是我们自己）当原命令存进去
    if (cur?.command === wrapperCmd) return { next: null, reason: '已是最新，不用改' }
    return {
      next: { ...cur, type: 'command', command: wrapperCmd, _easTerm: STATUSLINE_TAG },
      reason: '更新包装层（原命令保持不变）'
    }
  }
  return {
    next: {
      ...(cur ?? {}),
      type: 'command',
      command: wrapperCmd,
      _easTerm: STATUSLINE_TAG,
      // 原来没配 statusline 时存空串 —— 卸载时据此知道该整个删掉而不是放回一个空命令
      _easWrapped: originalCmd
    },
    reason: originalCmd ? '包装用户原有的 statusline' : '用户原来没有 statusline，只装我们这层'
  }
}

/**
 * 规划卸载。**只动我们那层**：不是我们装的就一个字不碰。
 * 返回 undefined 表示「整个 statusLine 字段都该删掉」（用户原来就没有）。
 */
export function planUninstall(cur: StatusLineCfg | null | undefined): { next: StatusLineCfg | undefined; changed: boolean } {
  if (!cur || cur._easTerm !== STATUSLINE_TAG) return { next: cur ?? undefined, changed: false }
  const wrapped = typeof cur._easWrapped === 'string' ? cur._easWrapped : ''
  if (!wrapped) return { next: undefined, changed: true } // 原来就没有 → 整个删掉
  const { _easTerm, _easWrapped, ...rest } = cur
  return { next: { ...rest, type: 'command', command: wrapped }, changed: true }
}
