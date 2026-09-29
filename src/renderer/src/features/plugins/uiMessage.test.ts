import test from 'node:test'
import assert from 'node:assert/strict'
import { uiMessageChip, uiMessageAllowed, UI_MESSAGE_MAX_CHARS, UI_MESSAGE_LABEL_MAX, UI_MESSAGE_REMOTE_ERROR, UI_MESSAGE_UNFOCUSED_ERROR, UI_MESSAGE_UNKNOWN_ERROR } from './uiMessage.ts'

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

test('闸门：只有本地插件 + 焦点在面板里才放行', () => {
  assert.deepEqual(uiMessageAllowed({ remote: false, focused: true }), { ok: true })
})

test('闸门：远程插件一律拒，焦点在也不行', () => {
  assert.deepEqual(uiMessageAllowed({ remote: true, focused: true }), { ok: false, error: UI_MESSAGE_REMOTE_ERROR })
  assert.deepEqual(uiMessageAllowed({ remote: true, focused: false }), { ok: false, error: UI_MESSAGE_REMOTE_ERROR })
})

test('闸门：本地插件但焦点不在面板（刚加载就发 / 用户在别处）→ 拒', () => {
  assert.deepEqual(uiMessageAllowed({ remote: false, focused: false }), { ok: false, error: UI_MESSAGE_UNFOCUSED_ERROR })
})

test('闸门：插件列表里找不到（已卸载等）→ 拒', () => {
  assert.deepEqual(uiMessageAllowed({ remote: null, focused: true }), { ok: false, error: UI_MESSAGE_UNKNOWN_ERROR })
})

test('闸门的拒绝原因都是中文人话，不是空串', () => {
  for (const e of [UI_MESSAGE_REMOTE_ERROR, UI_MESSAGE_UNFOCUSED_ERROR, UI_MESSAGE_UNKNOWN_ERROR]) assert.match(e, /[\u4e00-\u9fff]/)
})
