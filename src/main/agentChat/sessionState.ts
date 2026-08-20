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
  /** 谁开的 / 叫什么。**身份必须存在这里，不能只留在渲染层的 pane 上。**
   *
   *  「关节点不杀进程」把节点和进程的生命周期拆开了：pane 随节点关闭消失，进程还在跑。
   *  身份要是跟着 pane 走，关掉节点那一刻团队面板就不认识它了 —— 角色名退回 CLI 名、
   *  「全部叫停」把它漏掉（不再算团队成员）、team_status 完全看不见它 —— 而它仍在烧
   *  token。2026-08-19 真机验证抓到：关掉 css-dup-auditor 的节点后，进程 69707 还在写
   *  .plans/，面板上却只剩一个没名字的 claude。那正是「关节点不杀进程必须与面板能停
   *  同时成立」这条纪律被绕过去的路径。**身份是会话的属性，不是视图的属性。** */
  owner?: 'team'
  role?: string
  /** 会话建立的时刻。面板给「在跑」的行显示已运行时长要用它。
   *  **不能拿 lastActiveAt 顶替** —— 那个每收到一块 stdout 就续期，对活跃会话永远趋近
   *  0，显示出来是「在跑 0s」，读起来像根本没在跑。 */
  startedAt: number
  /** 这一轮还没跑完。turn.start → true，turn.done → false。
   *
   *  **没有它就分不清「卡死」和「干完了」。** 跨进程能拿到的另一个信号只有静默时长，
   *  而 headless 流式模式跑完一轮并不退出 —— 它和真卡住的进程在静默上完全一样。
   *  2026-08-19 实测：invariant-auditor 写完 findings 之后静默 13 分钟，面板报「可能
   *  卡住」，实际早干完了。undefined = 还没跑过任何一轮。 */
  busy?: boolean
}

/** 一个活会话是否已经空闲超过阈值、该回收了。
 *  已经死了的会话不算——回收动作（杀进程）针对的是「还占着资源但没人理」的进程，
 *  死会话没有进程可杀，重复判 true 没有意义，也会误导调用方再杀一次不存在的进程。
 *  用严格大于：「超过」15 分钟才回收，刚好卡在 15 分钟整不算。 */
/** 团队 agent 交活之后的回收阈值。**比普通会话短得多，这是有意的。**
 *
 *  那 15 分钟是给普通 AI 对话留的：你可能只是走开一会儿，回来接着聊，
 *  杀掉就丢了上下文。团队 agent 不是这个场景 —— 它这一轮的产出**已经落盘**在
 *  `.plans/<role>/`，进程留着不再产生任何价值，而一个 CLI 进程还挂着 API 连接。
 *  派 5 个就是 5 份闲置。
 *
 *  为什么不设得更短（比如 30 秒）：agent 停下来之后，人还需要一点时间决定
 *  「它是干完了还是卡在半路」——后者要用 `team_send` 推它继续，进程没了就推不动了。
 *  三分钟够看一眼 findings.md。 */
export const TEAM_IDLE_TIMEOUT_MS = 3 * 60 * 1000

export function shouldReap(s: SessionRecord, now: number): boolean {
  if (!s.alive) return false
  // 团队派生 **且这一轮已经跑完** 才走短阈值。
  // busy === true（还在跑）不能回收 —— lastActiveAt 虽然一直在续期，但万一它真的
  // 卡住不出声，15 分钟的窗口是留给人去面板上看一眼的，不该被这条抢先杀掉。
  // busy === undefined（一轮都没跑过）同理不算：那种会话刚建起来。
  const limit = s.owner === 'team' && s.busy === false ? TEAM_IDLE_TIMEOUT_MS : IDLE_TIMEOUT_MS
  return now - s.lastActiveAt > limit
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
