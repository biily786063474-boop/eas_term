// 会话状态机——全是纯函数，不碰进程、不碰时钟（`now` 一律由调用方传入）。
// 落实 spec §A.5 两条已拍板的决定，别自作主张改：
//
// 决定 3：中途改模型/effort 不打断当前任务，下一条消息才生效。
//   `--model` / `--effort` 是启动参数，会话跑起来之后改不了；立刻重开会把正在跑的
//   活截断。所以 applyParamChange 只记 pending，不动当前会话的 model/effort。
// 决定 4：常驻进程 + 15 分钟空闲回收。回收只杀进程、保留会话 id，
//   下次发送时用 resume 无感接上。

import type { StartOpts } from '../../shared/agentChat.ts'

/** 空闲多久回收进程。取 15 分钟的理由见 spec §A.5：
 *  resume 一次的代价就是一次冷启动（实测数秒），而人离开十几分钟多半不会马上回来。
 *  **这是一处定义，别在别的文件里再写一个。** */
export const IDLE_TIMEOUT_MS = 15 * 60 * 1000

export interface SessionRecord {
  id: string
  cli: string
  cwd: string
  alive: boolean
  lastActiveAt: number
  model?: string
  effort?: string
  /** Codex 的沙箱级别（read-only / workspace-write / danger-full-access，对应
   *  capabilities.sandboxLevels）。只在 start 时定一次，这里不用 pending 机制——
   *  目前没有「运行中途改沙箱」的入口。但 Codex 的 exec 每条消息都会触发 restart
   *  （见 session.ts），若 effectiveOpts 不把它带上，每次 restart 都会静默退回
   *  buildArgs 里的默认值（workspace-write），用户选的 read-only 形同虚设——
   *  这不是一个可以晚点再补的边角情形，是 Codex 场景下几乎每条消息都会踩到的路径。 */
  sandbox?: string
  /** 待生效的模型/effort——中途改的不动当前值，下次发送时才生效（决定 3） */
  pending?: { model?: string; effort?: string }
  resumeId?: string
  /** 用户在 B 的询问卡片上明确选了"这次不装"审批 hook。跟 sandbox 同一个理由必须
   *  存在 SessionRecord 上，不能只是 start() 那一次性的参数：这是"这个会话"要不要
   *  保护的持续状态，不是"这一次 restart"的一次性开关——Codex 的每条消息都会触发
   *  restart，如果 effectiveOpts 不把它带上，每次 restart 都会静默变回"要装"，
   *  用户明确拒绝过的选择形同虚设（原样照抄 sandbox 字段头顶那段注释的论证）。 */
  skipApprovalHook?: boolean
  /** 「先问再做」模式。跟 sandbox / skipApprovalHook 一样要带过 restart ——
   *  不带的话空闲回收后重开，模型就不再先问了，而界面上开关还开着 */
  askFirst?: boolean
}

/** 一个活会话是否已经空闲超过阈值、该回收了。
 *  已经死了的会话不算——回收动作（杀进程）针对的是「还占着资源但没人理」的进程，
 *  死会话没有进程可杀，重复判 true 没有意义，也会误导调用方再杀一次不存在的进程。
 *  用严格大于：「超过」15 分钟才回收，刚好卡在 15 分钟整不算。 */
export function shouldReap(s: SessionRecord, now: number): boolean {
  if (!s.alive) return false
  return now - s.lastActiveAt > IDLE_TIMEOUT_MS
}

/** 下一条消息该怎么发的判定，顺序固定：
 *    1. 进程不活（已被回收或从没起过）→ restart
 *    2. 有待生效参数（pending）→ restart（决定 3：改参数不打断当前任务，
 *       但下一条消息必须用新参数重开）
 *    3. 否则 → send（直接喂给活着的进程，不重启）
 *
 *  restart 时的 opts：用当前 model/effort 被 pending 覆盖过的结果——没被 patch 到
 *  的字段保留原值，不会因为只改了 effort 就把 model 弄丢；并带上 resumeId，
 *  好让新进程无感接上原来的会话（决定 4）。
 *
 *  `now` 在这里不参与判定：是否该回收（杀进程、把 alive 置 false）由外部的空闲
 *  扫描用 shouldReap 完成并写回 SessionRecord，这里只读那个已经维护好的 alive
 *  标志。参数依然保留在签名里，一是和 shouldReap 同型，二是给调用方一个固定的
 *  调用约定，不必因为将来这里要加时间相关判定而改调用点。 */
export function planSend(
  s: SessionRecord,
  now: number
): { action: 'send' | 'restart'; opts: StartOpts } {
  void now
  const opts = effectiveOpts(s)
  if (!s.alive) return { action: 'restart', opts }
  if (s.pending) return { action: 'restart', opts }
  return { action: 'send', opts }
}

/** 记下待生效的模型/effort，不动当前会话正在用的值——改的是「下一次要用什么」，
 *  不是「现在用什么」（决定 3）。和已有的 pending 合并而不是整体替换：用户可能
 *  先改了 model 还没来得及发下一条、又改了 effort，两次待生效的值都要保留，
 *  不能后一次调用把前一次冲掉。 */
export function applyParamChange(
  s: SessionRecord,
  patch: { model?: string; effort?: string }
): SessionRecord {
  return {
    ...s,
    pending: { ...s.pending, ...patch }
  }
}

// ---- 纯函数小工具 ----

function effectiveOpts(s: SessionRecord): StartOpts {
  return {
    cwd: s.cwd,
    model: s.pending?.model ?? s.model,
    effort: s.pending?.effort ?? s.effort,
    resumeId: s.resumeId,
    sandbox: s.sandbox,
    skipApprovalHook: s.skipApprovalHook,
    askFirst: s.askFirst
  }
}
