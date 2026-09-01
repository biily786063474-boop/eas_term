import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  resolveShortcuts,
  recordKeys,
  keysRejectReason,
  parseKeys,
  matchesShortcut,
  matchesDef,
  formatKeys,
  findConflicts,
  SHORTCUTS,
  type ShortcutDef
} from './shortcuts.ts'

/** 造一个键盘事件的最小形状 */
const ev = (
  key: string,
  mods: { meta?: boolean; ctrl?: boolean; shift?: boolean; alt?: boolean } = {}
): { key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean } => ({
  key,
  metaKey: !!mods.meta,
  ctrlKey: !!mods.ctrl,
  shiftKey: !!mods.shift,
  altKey: !!mods.alt
})

// ── 解析 ──────────────────────────────────────────────────────
test('解析：修饰键与主键', () => {
  assert.deepEqual(parseKeys('Mod+T'), { mod: true, shift: false, alt: false, key: 'T' })
  assert.deepEqual(parseKeys('Shift+Mod+D'), { mod: true, shift: true, alt: false, key: 'D' })
  assert.deepEqual(parseKeys('Delete'), { mod: false, shift: false, alt: false, key: 'Delete' })
})

test('解析：单字母一律大写，特殊键原样', () => {
  assert.equal(parseKeys('f').key, 'F')
  assert.equal(parseKeys('Escape').key, 'Escape')
})

// ── 匹配 ──────────────────────────────────────────────────────
test('Mod 在 mac 上是 ⌘、在别处是 Ctrl', () => {
  assert.equal(matchesShortcut(ev('t', { meta: true }), 'Mod+T', true), true)
  assert.equal(matchesShortcut(ev('t', { ctrl: true }), 'Mod+T', true), false, 'mac 上 Ctrl+T 不该命中 ⌘T')
  assert.equal(matchesShortcut(ev('t', { ctrl: true }), 'Mod+T', false), true)
  assert.equal(matchesShortcut(ev('t', { meta: true }), 'Mod+T', false), false)
})

test('**修饰键全等比对** —— Mod+D 不能把 Shift+Mod+D 一起吃掉', () => {
  // 这两条正是「向右分屏 / 向下分屏」的关系。只判「有没有按 Mod」的话，
  // 下分屏永远进不去 —— 上面那条先命中就 return 了。
  assert.equal(matchesShortcut(ev('d', { meta: true }), 'Mod+D', true), true)
  assert.equal(matchesShortcut(ev('d', { meta: true, shift: true }), 'Mod+D', true), false)
  assert.equal(matchesShortcut(ev('d', { meta: true, shift: true }), 'Shift+Mod+D', true), true)
  assert.equal(matchesShortcut(ev('d', { meta: true }), 'Shift+Mod+D', true), false)
})

test('另一个修饰键按着就不算命中', () => {
  assert.equal(matchesShortcut(ev('t', { meta: true, alt: true }), 'Mod+T', true), false)
})

test('空格：事件里的 key 是 " "，定义里写 Space', () => {
  assert.equal(matchesShortcut(ev(' '), 'Space', true), true)
  assert.equal(matchesShortcut(ev(' '), 'F', true), false)
})

test('大小写无关 —— shift 或输入法都可能让 key 变大写', () => {
  assert.equal(matchesShortcut(ev('F'), 'F', true), true)
  assert.equal(matchesShortcut(ev('f'), 'F', true), true)
})

test('等价键：Delete 与 Backspace 都要认', () => {
  // Mac 键盘上写着 delete 的那个键发的是 Backspace，只认 Delete 会「按删除键没反应」
  const def = SHORTCUTS.find((d) => d.id === 'canvas.delete')!
  assert.equal(matchesDef(ev('Delete'), def, true), true)
  assert.equal(matchesDef(ev('Backspace'), def, true), true)
  assert.equal(matchesDef(ev('x'), def, true), false)
})

// ── 显示 ──────────────────────────────────────────────────────
test('显示：mac 用符号，别处用单词', () => {
  assert.equal(formatKeys('Mod+T', true), '⌘T')
  assert.equal(formatKeys('Mod+T', false), 'Ctrl+T')
  assert.equal(formatKeys('Shift+Mod+D', true), '⇧⌘D')
  assert.equal(formatKeys('Shift+Mod+D', false), 'Ctrl+Shift+D')
  assert.equal(formatKeys('F', true), 'F')
})

// ── 冲突 ──────────────────────────────────────────────────────
test('**冲突按作用域分组判** —— 同键不同作用域是刻意复用，不是冲突', () => {
  // Mod+D 在分屏是「向右分屏」、在画布是「复制选中」。跨作用域一刀切会报假冲突，
  // 报多了人就不看了。
  const list: ShortcutDef[] = [
    { id: 'a', label: 'A', group: 'g', scope: 'split', keys: 'Mod+D' },
    { id: 'b', label: 'B', group: 'g', scope: 'canvas', keys: 'Mod+D' }
  ]
  assert.deepEqual(findConflicts(list), [])
})

test('同作用域里的重键要报出来', () => {
  const list: ShortcutDef[] = [
    { id: 'a', label: 'A', group: 'g', scope: 'canvas', keys: 'Mod+D' },
    { id: 'b', label: 'B', group: 'g', scope: 'canvas', keys: 'Mod+D' }
  ]
  const c = findConflicts(list)
  assert.equal(c.length, 1)
  assert.deepEqual(c[0].ids.sort(), ['a', 'b'])
})

test('等价键也参与冲突检查', () => {
  const list: ShortcutDef[] = [
    { id: 'a', label: 'A', group: 'g', scope: 'canvas', keys: 'Delete', alt: ['Backspace'] },
    { id: 'b', label: 'B', group: 'g', scope: 'canvas', keys: 'Backspace' }
  ]
  assert.equal(findConflicts(list).length, 1, 'Backspace 撞上了，虽然一个是主键一个是等价键')
})

// ── 注册表自身 ────────────────────────────────────────────────
test('注册表：id 唯一（改键要拿 id 当存储 key）', () => {
  const ids = SHORTCUTS.map((s) => s.id)
  assert.equal(new Set(ids).size, ids.length)
})

test('注册表：自身没有同作用域重键', () => {
  assert.deepEqual(findConflicts(SHORTCUTS), [], '有重键就说明两条定义会互相抢')
})

test('注册表：每条都填了必填字段', () => {
  for (const s of SHORTCUTS) {
    assert.ok(s.id && s.label && s.group && s.scope && s.keys, `${s.id} 有空字段`)
  }
})

// ── 三期：自定义改键 ──────────────────────────────────────────────
const DEFS: ShortcutDef[] = [
  { id: 'a', label: 'A', group: 'g', scope: 'split', keys: 'Mod+T' },
  { id: 'b', label: 'B', group: 'g', scope: 'canvas', keys: 'Delete', alt: ['Backspace'] }
]

test('覆盖只换主键位', () => {
  const r = resolveShortcuts(DEFS, { a: 'Mod+K' })
  assert.equal(r.find((d) => d.id === 'a')!.keys, 'Mod+K')
  assert.equal(r.find((d) => d.id === 'b')!.keys, 'Delete', '没改的那条不动')
})

test('**等价键不跟着改** —— 那是物理事实不是偏好', () => {
  // Mac 键盘上写着 delete 的键发的是 Backspace。用户把主键改成别的，
  // 这条物理等价关系依然成立；跟着改只会让删除键失灵。
  const r = resolveShortcuts(DEFS, { b: 'X' })
  assert.deepEqual(r.find((d) => d.id === 'b')!.alt, ['Backspace'])
})

test('认不出的 id 直接忽略（老版本改过、后来被删掉的键）', () => {
  const r = resolveShortcuts(DEFS, { 已经不存在了: 'Mod+Z' })
  assert.equal(r.length, 2)
})

test('录制：只按修饰键还不算一个组合', () => {
  assert.equal(recordKeys(ev('Meta', { meta: true }), true), null)
  assert.equal(recordKeys(ev('Shift', { shift: true }), true), null)
})

test('录制：修饰键 + 主键', () => {
  assert.equal(recordKeys(ev('k', { meta: true }), true), 'Mod+K')
  assert.equal(recordKeys(ev('d', { meta: true, shift: true }), true), 'Shift+Mod+D')
  assert.equal(recordKeys(ev('k', { ctrl: true }), false), 'Mod+K', '非 mac 上 Ctrl 就是 Mod')
})

test('录制：空格录成 Space（事件里它是 " "）', () => {
  assert.equal(recordKeys(ev(' '), true), 'Space')
})

test('**录制：mac 上按着 Ctrl 不录** —— 本注册表的组合里没有它的位置', () => {
  // 录进去会得到一个永远匹配不上的键：matchesShortcut 见到 otherMod 直接判否，
  // 用户会以为「设了但没反应」。
  assert.equal(recordKeys(ev('k', { ctrl: true }), true), null)
})

test('拒绝：系统占着的组合', () => {
  assert.ok(keysRejectReason('Mod+Q', 'global'), '⌘Q 会让 app 退出')
  assert.ok(keysRejectReason('Mod+H', 'global'))
  assert.equal(keysRejectReason('Mod+K', 'global'), null, '普通组合放行')
})

test('**拒绝：会打字的作用域里不许用裸键**', () => {
  // global / split 那边没有「输入焦点让路」的守卫，把 R 设成全局键 =
  // 以后任何输入框里都打不出 r。
  assert.ok(keysRejectReason('R', 'global'))
  assert.ok(keysRejectReason('R', 'split'))
  assert.equal(keysRejectReason('R', 'canvas'), null, '画布有让路守卫，允许裸键')
})

test('拒绝：Shift＋字母不是独立组合', () => {
  assert.ok(keysRejectReason('Shift+R', 'canvas'))
})
