// 「分屏打开」挑哪几张卡：当前筛选下、有内容、没发、没标「不发」，按卡片顺序取前 max 个（宿主分屏最多 6 格）
// 与 ui/panel.html 内联的 pickForSplit 同步，改一处改两处
const hasContent = (c) => !!(c.title || c.body || c.tags?.length || c.media?.length)
export function pickForSplit(cards, filter, max = 6) {
  const inFilter = (c) => (filter === 'p1' ? c.p1 : true)
  return cards.filter((c) => inFilter(c) && hasContent(c) && c.status !== 'published' && c.status !== 'skipped').slice(0, max)
}

// 分屏格子的 key = `<batchId>:<platform>`（不能只用平台 id）：宿主按 key 判断「已在分屏里」，
// 只用平台 id 时换批次后旧批次的 X 格会被当成新批次的 X 格复用，头条还拿着旧 batchId，复制 / 标记全落到旧帖子上。
// 带上批次后旧批次的格子就成了可被替换的格子。平台 id 不含冒号，取最后一个冒号之后。
export const cellKey = (batchId, platform) => `${batchId}:${platform}`
export const platformOfKey = (key) => String(key).slice(String(key).lastIndexOf(':') + 1)
/** panel/split.open 的参数（与 ui/panel.html 的 splitParams 同步，改一处改两处） */
export function splitParams(batch, cards) {
  return {
    title: '发布分屏 · ' + batch.title, max: 6,
    cells: cards.map((c) => ({ key: cellKey(batch.batchId, c.platform), url: c.url, companion: { panelId: 'cell', props: { batchId: batch.batchId, platform: c.platform } } })),
    published: batch.cards.filter((c) => c.status === 'published').map((c) => cellKey(batch.batchId, c.platform))
  }
}
