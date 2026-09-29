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
