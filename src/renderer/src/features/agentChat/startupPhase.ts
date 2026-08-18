// 「会话建立之前，这个面板处于哪一步」——纯函数，不引 React / electron / store，
// `node --test` 能直接加载（同 features/status/machine.ts 立的规矩）。
//
// **为什么只管「之前」这一半。** 会话建立之后（思考 / 执行 / 完成）的状态，
// CLI 的事件流就是唯一真相，由 reduce.ts 从事件推导，渲染层一个字都不该另记 ——
// 那正是 awaiting 那个洞的教训：同一件事记在两个地方，必然有一处覆盖不到的缝。
//
// 但会话建立**之前**移植不了：那时候 CLI 进程根本没起来，一个事件都没有。
// 探测本机装了哪些 CLI、用户选了哪个、spawn 中、spawn 失败 —— 这四步只有前端知道。
// 它们原来是四个各自独立的 useState（clis / selected / starting / startError），
// 能组合出一堆构造得出来、语义上不可能的状态：starting 同时 sessionId 非空、
// startError 非空同时还在 starting……收敛成一个联合类型之后，那些组合根本写不出来。
import type { CliInfo } from '../../../../shared/agentChat.ts'

export type StartupPhase =
  /** 正在探测本机装了哪些 CLI */
  | { k: 'detecting' }
  /** 探测完了，一个可用的都没有 */
  | { k: 'none' }
  /** 可以开始了。selected 一定在 clis 里（选项就是从它渲染的） */
  | { k: 'ready'; clis: CliInfo[]; selected: CliInfo }
  /** 正在起会话（spawn + 装 hook），这段没有事件可依据，只有前端知道 */
  | { k: 'starting'; clis: CliInfo[]; selected: CliInfo }
  /** 起会话失败。**保留 clis/selected**：用户改一下就能重试，不该被打回探测态 */
  | { k: 'failed'; clis: CliInfo[]; selected: CliInfo; error: string }

/** 从几个原始信号算出当前处于哪一步。
 *
 *  顺序即优先级，每一条都要能说出「为什么它压过下面的」：
 *  · starting 压过 failed —— 重试时上一次的错误还挂着，但界面该显示"正在起"
 *  · failed 压过 ready —— 有错就得让人看见，不能因为选项还在就装作没事
 *  · clis 为 null 一定是 detecting —— 那是"还没拉回来"，不是"拉回来了但是空的" */
export function startupPhaseOf(sig: {
  clis: CliInfo[] | null
  selected: CliInfo | null
  starting: boolean
  startError: string | null
}): StartupPhase {
  const { clis, selected, starting, startError } = sig
  if (clis === null) return { k: 'detecting' }
  if (clis.length === 0) return { k: 'none' }
  // selected 为空只可能出现在「拉回来了但还没选中第一个」的一瞬间（组件挂载后
  // 的那次 setState 之间）。这时候按 detecting 处理：界面上是"正在检测"而不是
  // 一个选不了 CLI 的空壳。
  if (!selected) return { k: 'detecting' }
  if (starting) return { k: 'starting', clis, selected }
  if (startError) return { k: 'failed', clis, selected, error: startError }
  return { k: 'ready', clis, selected }
}
