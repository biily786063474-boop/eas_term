import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isAppNavigation } from './navigationGuard.ts'
// 审查发现：主窗口没有导航守卫，拖一个链接进来就把工作台导航到远程页面，那页面带着 preload 拿到全部接口。
test('只允许开发服务器同源与 renderer 目录下的 file 页面；其余一律不是应用内导航', () => {
  const env = { devUrl: 'http://localhost:5173/', rendererDir: '/app/out/renderer' }
  assert.equal(isAppNavigation('http://localhost:5173/index.html#x', env), true)
  assert.equal(isAppNavigation('file:///app/out/renderer/index.html', env), true)
  assert.equal(isAppNavigation('file:///app/out/renderer/index.html?x=1', env), true)
  for (const bad of ['https://evil.example/', 'http://localhost:9999/', 'file:///etc/passwd', 'file:///app/out/renderer/../../secret.html', 'javascript:alert(1)', 'data:text/html,hi', 'about:blank'])
    assert.equal(isAppNavigation(bad, env), false, bad)
  assert.equal(isAppNavigation('file:///app/out/renderer/index.html', { rendererDir: '/app/out/renderer' }), true, '没有 dev 地址时只认 file')
})
