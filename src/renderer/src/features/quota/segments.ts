// 额度条上要显示哪几段、按什么顺序。**从 QuotaBar 里提出来的纯函数。**
//
// 提出来的理由与 `agentChat/userMessages.ts` 那次一样：埋在组件里没法单测，
// 而它恰好是最容易悄悄错的一块 —— 原来的写法是 `hasCodex && hasClaude && <sep/>`，
// 两段时对，**加第三段时就会漏掉一个分隔符**，或者要写三条互相嵌套的条件、
// 加第四段时再错一次。而这种错不会让任何东西报警，只是界面上少一根竖线。
import { isWindowExpired, type CliQuota, type QuotaSnapshot, type QuotaWindow } from '../../../../shared/quota.ts'

/** 这个 CLI 现在**还算数**的那些格子。（从 QuotaBar 挪过来的，行为一字未改。）
 *
 *  过了重置时刻的要作废：事件流只在跨阈值时才报，「本周 79% → 窗口重置 → 下周一直
 *  没到阈值」这条路上没有任何东西会来覆盖它，那个 79% 会一直挂着，
 *  tooltip 里的「X 月 X 日重置」指的还是已经过去的时刻。 */
export function liveCells(q: CliQuota | undefined, now: number): QuotaWindow[] {
  if (!q) return []
  return [q.primary, q.secondary].filter((w): w is QuotaWindow => !!w && !isWindowExpired(w, now))
}

export interface QuotaSegment {
  name: string
  q: CliQuota
}

/**
 * 有数据的那几段，**顺序固定**。
 *
 * 顺序写死而不是按快照的键序：键序取决于谁先被写进去，
 * 于是用户每次瞟一眼额度条都要重新找哪个是哪个。
 *
 * 「有没有数据」的判据是 `liveCells` —— 它会把**已经过了重置时刻**的窗口滤掉。
 * 那种数字不再代表任何东西（周窗口重置之后，上周的 79% 挂在那儿比空着更误导）。
 *
 * omp 那段的名字取 `label`：同一个 omp 可以配不同服务商，
 * 只显示「omp」看不出这是谁的额度。
 */
export function quotaSegments(q: QuotaSnapshot, now: number): QuotaSegment[] {
  const all: { name: string; q?: CliQuota }[] = [
    { name: 'Codex', q: q.codex },
    { name: 'Claude Code', q: q.claude },
    { name: q.omp?.label ?? 'omp', q: q.omp }
  ]
  return all.filter((s): s is QuotaSegment => !!s.q && liveCells(s.q, now).length > 0)
}
