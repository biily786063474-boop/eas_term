// 会话状态机——全是纯函数，不碰进程、不碰时钟（`now` 一律由调用方传入）。
// 落实 spec §A.5 两条已拍板的决定，别自作主张改：
//
// 决定 3：中途改模型/effort 不打断当前任务，下一条消息才生效。
//   `--model` / `--effort` 是启动参数，会话跑起来之后改不了；立刻重开会把正在跑的
//   活截断。所以 applyParamChange 只记 pending，不动当前会话的 model/effort。
// 决定 4：常驻进程 + 15 分钟空闲回收。回收只杀进程、保留会话 id，
//   下次发送时用 resume 无感接上。

import type { CostTally } from '../../shared/teamCost'

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
  /** **进程是怎么没的。** `undefined` = 还活着（或从没起来过）。
   *
   *  只有 `alive` 的话，「跑完一轮优雅退出」和「网络一抖被打断」在面板上长得一模一样 ——
   *  用户 2026-08-20 反馈的正是后者被显示成了前者：活没干完，标签却写着这轮完了。
   *
   *  判据两条，命中任意一条就算中断：
   *  ① **退出时 `busy` 还是 true** —— 话说到一半进程没了，比退出码更硬的证据，
   *     而且不依赖任何错误文案解析（那种写法换个 CLI 版本或语言就失效）
   *  ② 退出码非 0 且非 null（null = 我们自己 kill 的，那是预期内的）
   *
   *  **它决定会话面板敢不敢自动收起** —— 收起一个「其实没干完」的会话，
   *  等于把没做完的活从用户眼前藏起来，比不收更糟。 */
  ended?: 'ok' | 'interrupted'
  /** 自动恢复已经试了几次。**只对团队 agent 用**（用户自己的对话由他自己决定要不要接着聊）。
   *  重启成功后清零 —— 下一次中断是新的一轮，不该背着上次的账。 */
  retries?: number
  /** 下一次自动恢复的时刻（ms epoch）。undefined = 没有在等待重试。 */
  retryAt?: number
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
  /** 这个会话烧了多少。**token 累加、花费取最新** —— 两个字段语义相反，
   *  实测与理由见 shared/teamCost.ts 文件头那张表。 */
  tally?: CostTally
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

/** **这一轮还在跑**时的回收阈值。
 *
 *  为什么需要它：`lastActiveAt` 每收到一块 stdout 才续期，而「主 agent 派了子 agent、
 *  自己在等」这段时间是**完全静默**的 —— claude 用 ultracode / Task 派活时正是如此。
 *  按 15 分钟算，一个正常干活的会话会在等子 agent 的途中被 kill，整趟工作丢掉
 *  （用户 2026-08-20 反馈）。「人走开了」和「它在等子 agent」在 lastActiveAt 上
 *  一模一样，唯一分得开的信号是 busy。
 *
 *  为什么不干脆「busy 时永不回收」：busy 靠 turn.start / turn.done 维护，
 *  万一 done 丢了，那个进程就再也回收不掉。给一个长阈值兜住两头 ——
 *  长任务够用，真卡死的最终也会被清掉。
 *
 *  取 4 小时：比任何一趟合理的 agent 任务都长，又不至于让一个卡死的会话过夜。 */
export const BUSY_IDLE_TIMEOUT_MS = 4 * 60 * 60 * 1000

export function shouldReap(s: SessionRecord, now: number): boolean {
  if (!s.alive) return false
  // 三档，按「杀错了有多疼」排：
  //
  // ① 团队派生 **且这一轮已经跑完** → 3 分钟。停下来的 agent 留着只是占资源。
  // ② **这一轮还在跑** → 4 小时。它可能正在等自己派出去的子 agent（ultracode /
  //    Task），那段时间 stdout 完全静默，按 15 分钟算会把一个正常干活的会话
  //    杀在半路 —— **整趟工作不可逆地没了**，而它明明在干活。
  //    这一条以前不存在：老代码只是让 busy 的会话走「长」阈值（15 分钟），
  //    而上面那段注释写的却是「不能回收」，读起来像是已经保护住了。
  // ③ 其余（包括 busy === undefined，一轮都没跑过的新会话）→ 15 分钟。
  const limit =
    s.owner === 'team' && s.busy === false
      ? TEAM_IDLE_TIMEOUT_MS
      : s.busy === true
        ? BUSY_IDLE_TIMEOUT_MS
        : IDLE_TIMEOUT_MS
  return now - s.lastActiveAt > limit
}

/** 自动恢复的退避节奏。
 *
 *  为什么要退避而不是立刻重试：网络抖动的恢复时机没法预判，断着的时候连撞几次，
 *  **每一次都是一个完整上下文的钱**。20 秒 → 1 分钟 → 3 分钟，覆盖了绝大多数
 *  「一下子就好了」和「过一会儿才好」，加起来 4 分多钟；再不行就是真出事了，
 *  那时候该让人看见，而不是继续默默烧。 */
export const RECOVERY_DELAYS_MS = [20_000, 60_000, 180_000]

export type RecoveryPlan =
  /** 还没到点，等到 `at` 再来 */
  | { act: 'wait'; at: number }
  /** 现在就重启并续上 */
  | { act: 'go'; attempt: number }
  /** 试到头了，交给人 */
  | { act: 'give-up' }

/** 这个会话要不要自动恢复、什么时候。返回 null = 不归自动恢复管。
 *
 *  用户的要求原话：「我希望子 agent 不打扰用户，可以通过中断了的机制让主 agent
 *  重新唤醒他继续任务」。所以判据卡得很紧，只处理**确实是被打断的团队 agent**：
 *
 *  · `owner !== 'team'` → 不管。用户自己开的对话，要不要接着聊是他的事，
 *    替他重启一个进程既花钱又唐突。
 *  · `ended !== 'interrupted'` → 不管。正常跑完退出的不需要「恢复」。
 *  · 还活着 → 不管。
 *  · **没有 resumeId → 不管**。这是最要紧的一条：没有它，重启起来的是一个
 *    什么都不记得的新会话，它既不知道任务是什么、也不知道做到哪了，
 *    只会从头再来一遍 —— 那不是恢复，那是又花一份钱做重复的事。 */
export function planRecovery(s: SessionRecord, now: number): RecoveryPlan | null {
  if (s.owner !== 'team') return null
  if (s.alive) return null
  if (s.ended !== 'interrupted') return null
  if (!s.resumeId) return null
  const tried = s.retries ?? 0
  if (tried >= RECOVERY_DELAYS_MS.length) return { act: 'give-up' }
  const at = s.retryAt ?? now + RECOVERY_DELAYS_MS[tried]
  if (now < at) return { act: 'wait', at }
  return { act: 'go', attempt: tried + 1 }
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
