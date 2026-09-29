import test from 'node:test'
import assert from 'node:assert/strict'
import { uiMessageChip, uiMessageAllowed, frameInjectTargets, NO_TARGET_ERROR, UI_MESSAGE_MAX_CHARS, UI_MESSAGE_LABEL_MAX, UI_MESSAGE_REMOTE_ERROR, UI_MESSAGE_UNFOCUSED_ERROR, UI_MESSAGE_UNKNOWN_ERROR } from './uiMessage.ts'

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

// ── frameInjectTargets：ui/message 按面板所在 Frame 找注入目标（Task 7）──
type N = { id: string; leafId?: string; name?: string; component?: { type: string } }
const frame = (nodes: N[]): { nodes: N[] } => ({ nodes })
const leaves = [
  { id: 'L-a1', pane: { kind: 'agent', cwd: '/p' } },
  { id: 'L-t1', pane: { kind: 'terminal', ptyId: 'pty-1' } },
  { id: 'L-a2', pane: { kind: 'agent', cwd: '/p' } },
  { id: 'L-t2', pane: { kind: 'terminal', ptyId: 'pty-2' } },
  { id: 'L-code', pane: { kind: 'code', filePath: '/p/a.ts' } },
  { id: 'L-sub', pane: { kind: 'agent', cwd: '/p/sub' } }
]

test('frameInjectTargets：Frame 里没有 AI 对话或终端 → 空', () => {
  assert.deepEqual(frameInjectTargets(frame([]), leaves), [])
  assert.deepEqual(frameInjectTargets(frame([{ id: 'n-code', leafId: 'L-code' }, { id: 'n-note' }]), leaves), [])
  assert.match(NO_TARGET_ERROR, /这个 Frame 里没有 AI 对话或终端/)
})

test('frameInjectTargets：一个 AI 对话 → 一个目标，带节点名', () => {
  assert.deepEqual(frameInjectTargets(frame([{ id: 'n1', leafId: 'L-a1', name: '主对话' }]), leaves), [
    { nodeId: 'n1', leafId: 'L-a1', kind: 'agent', name: '主对话' }
  ])
})

test('frameInjectTargets：终端带 ptyId；多个目标保持节点顺序', () => {
  const r = frameInjectTargets(frame([
    { id: 'n1', leafId: 'L-t1', name: '跑测试' },
    { id: 'n2', leafId: 'L-a1', name: '写代码' }
  ]), leaves)
  assert.deepEqual(r, [
    { nodeId: 'n1', leafId: 'L-t1', kind: 'terminal', name: '跑测试', ptyId: 'pty-1' },
    { nodeId: 'n2', leafId: 'L-a1', kind: 'agent', name: '写代码' }
  ])
})

test('frameInjectTargets：插件面板等组件节点、找不到 leaf 的节点都排除', () => {
  const r = frameInjectTargets(frame([
    { id: 'n-panel', component: { type: 'plugin-panel' }, name: 'Opus 画廊' },
    { id: 'n-gone', leafId: 'L-missing' },
    { id: 'n1', leafId: 'L-a1' }
  ]), leaves)
  assert.deepEqual(r.map((t) => t.nodeId), ['n1'])
})

test('frameInjectTargets：子 Frame 的节点不算（只看传进来这个 Frame 自己的 nodes）', () => {
  // 子 Frame 是独立的 CanvasFrame（parentId 指向父），它的节点不在父 Frame 的 nodes 里
  const parent = frame([{ id: 'n1', leafId: 'L-a1' }])
  const r = frameInjectTargets(parent, leaves)
  assert.ok(!r.some((t) => t.leafId === 'L-sub'))
  assert.equal(r.length, 1)
})

test('frameInjectTargets：没起名按种类各自计数兜底「AI 对话 N」「终端 N」', () => {
  const r = frameInjectTargets(frame([
    { id: 'n1', leafId: 'L-a1' },
    { id: 'n2', leafId: 'L-t1' },
    { id: 'n3', leafId: 'L-a2', name: '  ' },
    { id: 'n4', leafId: 'L-t2', name: '部署' }
  ]), leaves)
  assert.deepEqual(r.map((t) => t.name), ['AI 对话 1', '终端 1', 'AI 对话 2', '部署'])
})
