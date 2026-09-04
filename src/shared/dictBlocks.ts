// 词条的「区块」标签：这条手法适合用在页面的哪一块。
//
// ── 为什么是标签不是分类的第三级 ────────────────────────────────────────
// 因为它**正交**于分类树。实测（`docs/词典分类改造-2026-09-03.html`）：
//   · 30% 的词条同时属于 ≥2 个区块（毛玻璃用在弹层、导航栏、卡片）
//   · 41% 的词条不属于任何区块（缓动曲线、噪点、金属虹彩是通用手法）
// 做成分类的第三级，这两批都要被扭曲：前者重复挂或被迫二选一，
// 后者被逼着选一个不属于自己的格子。
//
// ── 这份表和词库里的 `blocks` 字段 ──────────────────────────────────────
// 词条的 `blocks` 是**这张表里的名字**。主进程校验 `dict_add` 时要用，
// 而词库是渲染层的 import、主进程够不着 —— 所以名单在这里，
// `dictBlocks.test.ts` 断言词库里出现过的每个区块名都在这份表里。

/** 区块名单。**顺序 = 界面上 chip 的顺序**，大致按「一张页面从上到下」排。 */
export const DICT_BLOCKS = [
  '导航栏',
  '标签栏',
  '侧边栏',
  '首屏',
  '金刚区',
  '轮播',
  '搜索',
  '列表',
  '卡片',
  '表格',
  '图集',
  '表单',
  '按钮',
  '弹层',
  '空状态',
  '页脚'
] as const

export type DictBlock = (typeof DICT_BLOCKS)[number]

/** 一条词条最多挂几个区块。挂太多等于没挂 —— 那说明它其实是个通用手法。 */
export const BLOCKS_MAX = 3

const SET: ReadonlySet<string> = new Set(DICT_BLOCKS)

/**
 * 把外部传进来的 blocks 收成合法值。
 *
 * @returns 只保留名单里有的、去重、最多 `BLOCKS_MAX` 个；
 *          一个都不合法时返回 `null`（调用方据此**不写这个字段**，
 *          而不是写一个空数组 —— 空数组和「没标过」在界面上是两回事）。
 */
export function normalizeBlocks(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null
  const out: string[] = []
  for (const x of v) {
    if (typeof x === 'string' && SET.has(x) && !out.includes(x)) out.push(x)
    if (out.length >= BLOCKS_MAX) break
  }
  return out.length ? out : null
}
