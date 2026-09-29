// 面板跑在 iframe 里、CSP 锁死，逻辑靠 Task 6 真机验证；这里只钉住不能违反的约束。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const html = fs.readFileSync(new URL('../ui/panel.html', import.meta.url), 'utf8')

test('面板约束：第三方内容不走 innerHTML、不外连、体积在宿主上限内、用了 ui/message', () => {
  assert.doesNotMatch(html, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/)
  assert.doesNotMatch(html, /\b(src|href)=["']https?:/)
  assert.doesNotMatch(html, /<form/i, 'CSP form-action none')
  assert.ok(Buffer.byteLength(html) < 512 * 1024)
  assert.match(html, /rpc\('ui\/message'/)
  assert.match(html, /rpc\('ui\/open-link'/)
  assert.match(html, /gallery_images/)
})

test('并发请求防护与选中高亮修复', () => {
  assert.doesNotMatch(html, /toggleAttribute\('aria-current'/, 'setAttribute/removeAttribute 替代 toggleAttribute')
  assert.match(html, /loadGen/, 'loadGen 防止列表并发覆盖')
})

test('Task 8：feed 流铺满、无翻页、IntersectionObserver 哨兵加载', () => {
  assert.doesNotMatch(html, /上一页|下一页/)
  assert.doesNotMatch(html, /id="(prev|next|pager|pageinfo)"/)
  assert.match(html, /IntersectionObserver/)
  assert.match(html, /id="sentinel"/)
  assert.doesNotMatch(html, /innerHTML/)
  assert.match(html, /loadGen/)
  assert.match(html, /已经到底了/)
  // 铺满：auto-fill + 1fr 等宽列；不再有按高度限宽 / 容器查询
  assert.match(html, /#grid\{[^}]*grid-template-columns:repeat\(auto-fill,minmax\(\d+px,1fr\)\)/)
  assert.doesNotMatch(html, /container-type|100cqh|100cqw/)
  assert.doesNotMatch(html, /#grid\{[^}]*justify-content:center/)
  assert.match(html, /#grid\{[^}]*grid-auto-rows:max-content/)
  assert.match(html, /\.card img\{[^}]*aspect-ratio:16\/10[^}]*object-fit:cover/)
  assert.match(html, />做同款</)
  assert.doesNotMatch(html, /用它做/)
  assert.doesNotMatch(html, /先点一下/)
  assert.match(html, /target\?\.kind === 'terminal'/)
  assert.match(html, /已挂到 AI 对话「/)
  assert.match(html, /已粘贴到终端「/)
})

test('Task 8 fix：握手完成前不发 gallery_list（S.ready 闸门，握手后才 observe）', () => {
  assert.match(html, /if \(!S\.ready \|\| S\.loading/)
  const hs = html.indexOf("'ui/notifications/initialized'")
  const ready = html.indexOf('S.ready = true')
  const obs = html.indexOf("io.observe($('#sentinel'))", ready)
  assert.ok(hs > 0 && ready > hs && obs > ready, 'initialized → ready → observe')
  assert.doesNotMatch(html, /^io\.observe/m, '脚本加载时不得直接 observe（watch() 只由已闸门的 loadMore 调用）')
})

test('Task 9：预加载——哨兵提前 1.5 屏、封面按可视优先、泵并发 2、无旧的按批取图', () => {
  assert.match(html, /rootMargin: '0px 0px 150% 0px'/, '哨兵离底部 1.5 屏就触发')
  assert.doesNotMatch(html, /rootMargin: '0px 0px 240px 0px'/)
  assert.match(html, /rootMargin: '100% 0px'/, '图片观察器上下各预留 1 屏')
  assert.match(html, /imgIo\.observe\(/, '每张卡片的 img 进共享观察器')
  assert.match(html, /new IntersectionObserver/)
  assert.match(html, /posterQ/, '待取队列')
  assert.match(html, /posterActive < 2/, '取图泵同时最多 2 个请求在途')
  assert.match(html, /slice\(0, 6\)/, '每次最多 6 个 slug')
  assert.match(html, /imgIo\.disconnect\(\)/, 'reset 时断开重建观察')
  assert.doesNotMatch(html, /loadPosters/, '删掉旧的按批次顺序取封面')
  assert.doesNotMatch(html, /S\.gen\b/, 'S.gen 已并入 loadGen')
  // 顶部状态：空闲为空，只有 loading 时显示「加载中…」
  assert.doesNotMatch(html, /S\.done \? \([^)]*\) : '加载中…'/)
  // 每批渲染完，哨兵仍在带 margin 的范围内要自动继续（不能只靠 IO 对同一元素不重复回调）
  assert.match(html, /getBoundingClientRect/)
})
