// 带上限的两层值缓存。**零 import，能单测**
//（同 canvas/mediaExts.ts 的做法：markdown.ts 那条依赖链引到了整个 store，
//  `node --test` 加载不了，所以把有判断的部分搬出来）。
//
// ── 为什么要有它（2026-08-30 实测）──────────────────────────────────
// 用户报「画布平移和放大卡」。3 秒平移里 Markdown 渲染被调了 **48895 次**
//（每帧 272 段）—— 平移把每个可见节点的正文全重渲染了一遍。
// 加了缓存之后中位帧 25ms → 16.4ms，掉帧率 24.3% → 1.9%。
//
// ── 三个只有量过才知道的坑 ────────────────────────────────────────
// ① **上限太小等于没有缓存。** 第一版设 300，而工作集是每帧 272 ——
//    正好卡在边缘，每帧淘汰掉下一帧要用的，实测命中率 **1%**。
// ② **别用 `a + '\0' + b` 拼出来的键。** 那等于每次调用都复制一遍整篇正文，
//    几万次多 KB 的字符串拷贝，GC 就是这么被喂起来的。两层 Map 不拼、不复制。
// ③ **满了不要 clear()。** 那会让缓存周期性全失效，
//    表现成「每隔一阵卡一下」，比没有缓存更难查。

export interface ValueCache<V> {
  /** 取；没有就用 make 算一个存进去 */
  get(outer: string, inner: string, make: () => V): V
  /** 当前条数（测试和排障用） */
  size(): number
}

/**
 * @param max 上限。**要装得下整个工作集还有富余** —— 卡在工作集边缘的上限
 *            比没有缓存更糟（见坑①）。
 */
export function createValueCache<V>(max: number): ValueCache<V> {
  const outerMap = new Map<string, Map<string, V>>()
  // 总条数散在各个内层 Map 里，每次数一遍太贵，自己记
  let count = 0

  return {
    get(outer, inner, make) {
      let byOuter = outerMap.get(outer)
      if (byOuter) {
        const hit = byOuter.get(inner)
        if (hit !== undefined) return hit
      } else {
        byOuter = new Map()
        outerMap.set(outer, byOuter)
      }
      const v = make()
      if (count >= max) {
        // 丢最旧那一组。**按组丢不按条丢**：逐条找最旧的要遍历所有内层 Map，
        // 那比重算还贵。Map 的迭代顺序就是插入顺序，够用了，
        // 不值得为它引一个 LRU 库。
        const oldest = outerMap.keys().next().value
        if (oldest !== undefined && oldest !== outer) {
          count -= outerMap.get(oldest)?.size ?? 0
          outerMap.delete(oldest)
        } else {
          // 只剩当前这一组了（一组里就几千条）—— 清它自己，别卡在这儿
          count -= byOuter.size
          byOuter.clear()
        }
      }
      byOuter.set(inner, v)
      count++
      return v
    },
    size() {
      return count
    }
  }
}
