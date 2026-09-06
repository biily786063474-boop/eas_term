import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BLOCKED_COMBOS, checkKeys, checkTarget, checkText, MAX_TYPE_LEN, NEVER_TOUCH } from './guard.ts'

test('**绝不点 Eas-Term 自己**（会绕开所有确认：清空画布、删项目、替你发消息）', () => {
  const r = checkTarget({ bundleId: 'com.biily.easterm' })
  assert.equal(r.ok, false)
  if (!r.ok) assert.match(r.error, /Eas-Term 自己/)
})

test('**绝不用鼠标去戳笔纵画板**（那会绕开生图路径的约定）', () => {
  const r = checkTarget({ bundleId: 'com.bizone.canvas' })
  assert.equal(r.ok, false)
  if (!r.ok) assert.match(r.error, /生图/)
})

test('这两条不给配置项关掉', () => {
  assert.equal(NEVER_TOUCH.length, 2)
  assert.ok(NEVER_TOUCH.every((n) => typeof n.why === 'string' && n.why.length > 10), '每条都要说清为什么')
})

test('别的 App 放行；拿不到 bundle id 不拦（真正的闸是授权窗口）', () => {
  assert.ok(checkTarget({ bundleId: 'com.apple.Safari' }).ok)
  assert.ok(checkTarget({ title: '某个窗口' }).ok)
  assert.ok(checkTarget({}).ok)
})

test('大小写不敏感', () => {
  assert.equal(checkTarget({ bundleId: 'COM.Biily.EasTerm' }).ok, false)
})

test('破坏性组合键被拒，且说明为什么', () => {
  for (const c of BLOCKED_COMBOS) {
    const r = checkKeys([...c])
    assert.equal(r.ok, false, c.join('+') + ' 应该被拒')
    if (!r.ok) assert.match(r.error, /不可撤销/)
  }
})

test('修饰键别名归一：command/⌘/meta 都算 cmd，顺序无关', () => {
  assert.equal(checkKeys(['Command', 'Q']).ok, false)
  assert.equal(checkKeys(['q', 'cmd']).ok, false)
  assert.equal(checkKeys(['⌘', 'w']).ok, false)
  assert.equal(checkKeys(['cmd', 'Backspace']).ok, false, 'backspace 归一成 delete')
})

test('正常组合键放行', () => {
  assert.ok(checkKeys(['cmd', 's']).ok)
  assert.ok(checkKeys(['tab']).ok)
  assert.ok(checkKeys(['cmd', 'shift', 'p']).ok)
})

test('空按键 / 太多键 被拒', () => {
  assert.equal(checkKeys([]).ok, false)
  assert.equal(checkKeys(['a', 'b', 'c', 'd', 'e', 'f']).ok, false)
})

test('输入文本：非空、有上限', () => {
  assert.ok(checkText('你好').ok)
  assert.equal(checkText('').ok, false)
  assert.equal(checkText(undefined).ok, false)
  const r = checkText('x'.repeat(MAX_TYPE_LEN + 1))
  assert.equal(r.ok, false)
  if (!r.ok) assert.match(r.error, /最多输入/)
})
