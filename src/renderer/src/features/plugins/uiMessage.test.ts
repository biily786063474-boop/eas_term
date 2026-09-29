import test from 'node:test'
import assert from 'node:assert/strict'
import { uiMessageChip, UI_MESSAGE_MAX_CHARS, UI_MESSAGE_LABEL_MAX } from './uiMessage.ts'

const P = { id: 'eas:opus-gallery', title: 'Opus 画廊' }
const msg = (text: string, label?: string): unknown => ({
  role: 'user',
  content: [{ type: 'text', text }],
  ...(label ? { _meta: { eas: { label } } } : {})
})

test('规范形状 → chip：label 带面板名前缀，id 按插件 + 正文去重', () => {
  const a = uiMessageChip(msg('参考这件作品', '@u1 风格'), P)
  assert.equal(a.ok, true)
  if (!a.ok) return
  assert.equal(a.chip.label, 'Opus 画廊 · @u1 风格')
  assert.equal(a.chip.text, '参考这件作品')
  assert.match(a.chip.id, /^plugin:eas:opus-gallery:[0-9a-f]{8}$/)
  const b = uiMessageChip(msg('参考这件作品', '别的名字'), P)
  assert.ok(b.ok && b.chip.id === a.chip.id, '同一段正文重复点不应挂两个')
  const c = uiMessageChip(msg('另一段'), P)
  assert.ok(c.ok && c.chip.id !== a.chip.id)
})

test('多个 text 块按空行拼接，非 text 块忽略', () => {
  const r = uiMessageChip({ role: 'user', content: [{ type: 'text', text: '甲' }, { type: 'image', data: 'x' }, { type: 'text', text: '乙' }] }, P)
  assert.ok(r.ok && r.chip.text === '甲\n\n乙')
})

test('缺省 label 取正文前 20 字；过长 label 截断', () => {
  const long = '一二三四五六七八九十'.repeat(3)
  const r = uiMessageChip(msg(long), P)
  assert.ok(r.ok && r.chip.label === 'Opus 画廊 · ' + long.slice(0, 20))
  const t = uiMessageChip(msg('正文', 'x'.repeat(80)), P)
  assert.ok(t.ok && t.chip.label === 'Opus 画廊 · ' + 'x'.repeat(UI_MESSAGE_LABEL_MAX - 1) + '…')
})

test('拒绝：非对象、非 user、空正文、超长', () => {
  assert.equal(uiMessageChip(null, P).ok, false)
  assert.equal(uiMessageChip({ role: 'assistant', content: [{ type: 'text', text: 'x' }] }, P).ok, false)
  assert.equal(uiMessageChip(msg('   '), P).ok, false)
  const big = uiMessageChip(msg('x'.repeat(UI_MESSAGE_MAX_CHARS + 1)), P)
  assert.equal(big.ok, false)
  if (!big.ok) assert.match(big.error, /60000/)
})
