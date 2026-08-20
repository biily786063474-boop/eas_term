// 「这个 agent 到底交活了没有」的判定。
//
// 起因是错误矩阵里的 E-13：**agent 说完成了，但根本没写 findings**。
// `team_status` 此前只会提醒主 agent「去读 findings.md 确认」，自己不看一眼 ——
// 而那个文件就在磁盘上，查它在不在、多大是零成本的。不查的代价是：
// 一个连文件都没建的 agent，和一个认真写了 200 行的 agent，在 `done: true` 上一模一样。
//
// 纯函数、不引 electron/fs，node --test 直接跑。

export type Delivered = 'missing' | 'thin' | 'ok'

/** 少于这个字节数就算「没实质内容」。
 *
 *  一份真写了东西的 findings 至少几百字节。取 120 是因为：一个中文标题行
 *  （`# xxx-reviewer 结论` + 换行）大约 30–40 字节，再加一两句套话也就一百出头 ——
 *  **只有标题和「正在分析中」这类占位，不该算交活**。
 *  往大了设会误判真短的结论（比如「查过了，这一条不成立」），往小了设等于没查。 */
export const THIN_BYTES = 120

/**
 * @param bytes 文件字节数；**null 表示文件不存在**（跟 0 字节要分开，
 *              前者是「压根没建」，后者是「建了但空着」，对人的提示不一样）
 */
export function deliveredOf(bytes: number | null): Delivered {
  if (bytes === null) return 'missing'
  return bytes < THIN_BYTES ? 'thin' : 'ok'
}

/** 给 agent 读的话。**说清楚该怀疑什么** —— 光报一个状态码，主 agent 还是会
 *  按「done 就是做完了」往下走。 */
export function deliveredHint(d: Delivered, role: string): string {
  if (d === 'missing')
    return `**${role} 根本没建 findings.md** —— 它说跑完了，但没有任何产出。别把它当成完成，去看它那个节点里说了什么。`
  if (d === 'thin')
    return `${role} 的 findings.md 只有很少内容（不到 ${THIN_BYTES} 字节），多半只写了个标题就停了。当成「没做完」处理。`
  return ''
}
