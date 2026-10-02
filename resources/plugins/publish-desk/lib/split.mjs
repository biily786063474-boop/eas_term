// 「分屏打开」挑哪几张卡：当前筛选下、有内容、没发、没标「不发」，按卡片顺序取前 max 个（宿主分屏最多 6 格）
// 与 ui/panel.html 内联的 pickForSplit 同步，改一处改两处
const hasContent = (c) => !!(c.title || c.body || c.tags?.length || c.media?.length)
export function pickForSplit(cards, filter, max = 6) {
  const inFilter = (c) => (filter === 'p1' ? c.p1 : true)
  return cards.filter((c) => inFilter(c) && hasContent(c) && c.status !== 'published' && c.status !== 'skipped').slice(0, max)
}
