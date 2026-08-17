import { test } from 'node:test'
import assert from 'node:assert'
import { DEFAULT_VIEW_MODE, restoreViewMode } from './viewModeRestore.ts'

// 默认视图从「分屏」改成了「画布」（规格 §六）。改默认值本身是一行，
// 难的是**别把已经在用分屏的人一起掀了** —— 而「亲手选了分屏」和「从没动过默认值」
// 在老存档里长得一模一样，都是 `viewMode:'split'`。
//
// 这组测试锁的就是那条区分规则。规则错了不会崩、不会报错，只会表现成
// 「我明明切回分屏了，重启又在画布」——用户多半不会报 bug，只会觉得软件不听话。

test('新默认是画布', () => {
  assert.equal(DEFAULT_VIEW_MODE, 'canvas')
})

test('全新用户：存档里什么都没有 → 新默认，且不算「选过」', () => {
  const r = restoreViewMode({})
  assert.equal(r.viewMode, 'canvas')
  assert.equal(r.viewModePicked, false)
})

test('老存档 split、无 viewModePicked → 推进画布（无从追溯，按没选过处理）', () => {
  assert.equal(restoreViewMode({ viewMode: 'split' }).viewMode, 'canvas')
})

test('**亲手选了分屏（viewModePicked:true）→ 必须留在分屏**', () => {
  // 整组里最要紧的一条：漏了它，用户每次切回分屏、重启后又被扔回画布，
  // 而且他没有任何办法让这个选择生效
  const r = restoreViewMode({ viewMode: 'split', viewModePicked: true })
  assert.equal(r.viewMode, 'split')
  assert.equal(r.viewModePicked, true)
})

test('老存档 board / gantt / canvas → 一律保持（默认是 split，能变成这些就说明当时切过）', () => {
  for (const mode of ['board', 'gantt', 'canvas'] as const) {
    const r = restoreViewMode({ viewMode: mode })
    assert.equal(r.viewMode, mode, `${mode} 应当原样保持`)
    assert.equal(r.viewModePicked, true, `${mode} 应当被判定为「选过」`)
  }
})

test('viewMode 是垃圾值 → 不能原样采信（存档是文件，被改坏过一次就够受）', () => {
  const r = restoreViewMode({ viewMode: 'x'.repeat(50) })
  assert.ok(['split', 'canvas', 'board', 'gantt'].includes(r.viewMode))
})

test('垃圾值 + viewModePicked:true → 回落分屏，不是画布', () => {
  // picked 为真说明用户确实选过，只是值坏了。这时套用新默认等于无视他选过这件事，
  // 回落到改默认之前的那个默认（split）更贴近他当初的意图
  assert.equal(restoreViewMode({ viewMode: 'nonsense', viewModePicked: true }).viewMode, 'split')
})

test('viewModePicked 是非布尔真值（存档被改坏）→ 不当成选过', () => {
  // 判据写成 `=== true` 而不是 truthy：'false' 这个字符串也是 truthy
  for (const v of ['true', 1, {}, 'false']) {
    assert.equal(restoreViewMode({ viewMode: 'split', viewModePicked: v }).viewMode, 'canvas', `${JSON.stringify(v)} 不该被当成选过`)
  }
})

test('viewMode 为 null / undefined → 按没选过处理，不抛', () => {
  assert.equal(restoreViewMode({ viewMode: null }).viewMode, 'canvas')
  assert.equal(restoreViewMode({ viewMode: undefined }).viewMode, 'canvas')
})
