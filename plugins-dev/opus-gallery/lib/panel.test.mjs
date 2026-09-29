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

test('Task 7：固定 3 列、卡片不被压扁、做同款、按宿主回的目标回显', () => {
  assert.match(html, /#grid\{[^}]*grid-template-columns:repeat\(3,1fr\)/)
  // 卡片是 overflow:hidden 的 button → 自动最小高度为 0，auto 行会被压到塞进容器高度（细条）。
  // 行高必须按内容走，超出就滚动。
  assert.match(html, /#grid\{[^}]*grid-auto-rows:max-content/)
  assert.match(html, /\.card img\{[^}]*aspect-ratio:16\/10[^}]*object-fit:cover/)
  assert.match(html, />做同款</)
  assert.doesNotMatch(html, /用它做/)
  assert.doesNotMatch(html, /先点一下/)
  assert.match(html, /target\?\.kind === 'terminal'/)
  assert.match(html, /已挂到 AI 对话「/)
  assert.match(html, /已粘贴到终端「/)
})
