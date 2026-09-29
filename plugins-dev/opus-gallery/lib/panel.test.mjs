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
