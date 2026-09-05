// 飘在对话上方的提示（`.ac-notice`）该怎么消失。**纯判据，抽出来测**。
//
// 用户 2026-09-05 定的规矩（截图指出「这段对话的来源认不出来了」那条关不掉）：
//   · **警告**（非红、fatal=false）：5 秒没有 hover 就自动关；hover 时不关、移开重新计时。
//   · **红色报错**（fatal=true）：只能手动关，永不自动消失 —— 它多半要你去做点什么
//     （去登录 / 去设置 / 换个 CLI），自动飘走就等于把该看的信息藏了。
//   · **两类都必须有关闭按钮** —— 这条是「关不掉」那个 bug 的根：sendError 那条当时
//     没给 ×，还写着注释说「下次发送时自己清掉」，可这次发送就失败了，于是它永远在。

/** 自动消失的等待时长（毫秒）。hover 会打断它。 */
export const NOTICE_AUTO_MS = 5000

/** 这条提示会不会自动消失。**只有非 fatal 的警告会。** */
export function autoDismisses(fatal: boolean): boolean {
  return !fatal
}

// ── 自动关的计时器该怎么起停 ────────────────────────────────────────────────
// 抽出来是为了能测「hover 暂停、移开重新计时、fatal 从不计时」这套状态机 ——
// 组件里那几个 setTimeout/clearTimeout 光看是对是错，出过一次「hover 完不重新计时」
// 就再也关不掉。这里把「此刻该不该有一个计时器在跑」变成纯判断。

export interface TimerIntent {
  /** 现在应不应该有一个自动关计时器在跑 */
  running: boolean
}

/** 给定 (fatal, 是否正被 hover)，算出此刻计时器该不该跑。
 *  · fatal → 永远不跑
 *  · 非 fatal 且没在 hover → 跑（5s 后关）
 *  · 非 fatal 但正被 hover → 不跑（暂停），移开后这个函数返回 true，调用方重新起 */
export function timerIntent(fatal: boolean, hovering: boolean): TimerIntent {
  return { running: autoDismisses(fatal) && !hovering }
}
