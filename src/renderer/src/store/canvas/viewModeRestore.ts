// 「启动时该进哪个视图」这一条规则。
//
// 单独一个文件是为了能测 —— 同 tidyOrder.ts：不引 React / electron / store，
// `node --test` 直接加载。（persist.ts 引到 store/shared 那条链，测试里加载不了。）
//
// 规则本身只有几行，但它错了的表现很难被发现：用户切回分屏、重启、又在画布里，
// 他不会报 bug，只会觉得「这软件不听话」。
import type { ViewMode } from './types'

const VALID: ReadonlySet<string> = new Set(['split', 'canvas', 'board', 'gantt'])

/** 默认视图。0.4.27 起从 'split' 改成 'canvas'（规格 §六）。 */
export const DEFAULT_VIEW_MODE: ViewMode = 'canvas'

/** 改默认值之前的那个默认值。`viewModePicked` 为真但存档里的值坏掉时回落到它 ——
 *  用户确实选过，只是值读不出来了，这时套用新默认等于无视他选过这件事。 */
const LEGACY_DEFAULT: ViewMode = 'split'

/**
 * 从存档里的两个字段还原「启动进哪个视图」。
 *
 * 难点不在改默认值，在于**「亲手选了分屏」和「从没动过默认值」在老存档里长得一模一样**
 * （都是 `viewMode:'split'`）。没有依据就只能二选一：要么尊重所有 split
 * （新默认对老用户完全不生效），要么一并推进画布（把明确选了分屏的人也掀了）。
 *
 * 判「选过」的两种证据：
 *  · `viewModePicked === true` —— 新版本里亲手切过，明确记下来了
 *  · 存档里的 viewMode 不是 split —— 老存档没有上面那个字段，但默认是 split，
 *    能变成 canvas/board/gantt 就说明当时切过
 *
 * 两种都没有 → 用新默认。代价是「亲手选了分屏的老用户」会被推进画布一次，
 * 他切回分屏后 `viewModePicked` 就写上了，不会有第二次。
 */
export function restoreViewMode(raw: { viewMode?: unknown; viewModePicked?: unknown }): {
  viewMode: ViewMode
  viewModePicked: boolean
} {
  const stored = typeof raw.viewMode === 'string' && VALID.has(raw.viewMode) ? (raw.viewMode as ViewMode) : null
  const explicit = stored !== null && stored !== 'split'
  const picked = raw.viewModePicked === true || explicit
  if (!picked) return { viewMode: DEFAULT_VIEW_MODE, viewModePicked: false }
  // 选过：能用存档里的值就用，值坏了回落到改默认之前的那个默认
  return { viewMode: stored ?? LEGACY_DEFAULT, viewModePicked: true }
}
