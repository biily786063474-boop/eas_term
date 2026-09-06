import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_REDACT_BUNDLES, redactRects, shouldRedact } from './redact.ts'

const box = { x: 0, y: 0, width: 100, height: 100 }

test('**默认清单非空**，密码管理器与终端默认就涂', () => {
  assert.ok(DEFAULT_REDACT_BUNDLES.length > 0)
  assert.equal(shouldRedact({ bounds: box, bundleId: 'com.1password.1password' }), true)
  assert.equal(shouldRedact({ bounds: box, bundleId: 'com.apple.Terminal' }), true)
  assert.equal(shouldRedact({ bounds: box, bundleId: 'com.apple.Safari' }), false)
})

test('bundle id 大小写不敏感', () => {
  assert.equal(shouldRedact({ bounds: box, bundleId: 'COM.1Password.1Password' }), true)
})

test('拿不到 bundle id 时靠标题兜底', () => {
  assert.equal(shouldRedact({ bounds: box, title: '生产环境 API Key' }), true)
  assert.equal(shouldRedact({ bounds: box, title: '修改密码' }), true)
  assert.equal(shouldRedact({ bounds: box, title: '周报' }), false)
  assert.equal(shouldRedact({ bounds: box }), false)
})

test('用户可以显式放行某个 bundle（把终端从清单里减掉）', () => {
  assert.equal(shouldRedact({ bounds: box, bundleId: 'com.apple.Terminal' }, { allowBundles: ['com.apple.Terminal'] }), false)
})

test('放行只对 bundle 生效，标题词不受影响（标题里带密码仍然涂）', () => {
  assert.equal(
    shouldRedact({ bounds: box, bundleId: 'com.apple.Safari', title: '我的密码本' }, { allowBundles: ['com.apple.Safari'] }),
    false,
    'bundle 放行优先'
  )
  assert.equal(shouldRedact({ bounds: box, title: '我的密码本' }, { allowBundles: ['com.apple.Safari'] }), true)
})

test('redactRects 只返回命中的窗口矩形', () => {
  const ws = [
    { bounds: { ...box, x: 10 }, bundleId: 'com.1password.1password' },
    { bounds: { ...box, x: 20 }, bundleId: 'com.apple.Safari' }
  ]
  assert.deepEqual(redactRects(ws).map((r) => r.x), [10])
})
