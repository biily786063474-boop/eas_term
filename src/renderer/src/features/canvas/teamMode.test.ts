import { test } from 'node:test'
import assert from 'node:assert/strict'
import { teamModeOf, teamModeTargetId, topFrameOf } from './teamMode.ts'

const frames = [
  { id: 'top', projectId: 'p1', teamMode: true },
  { id: 'sub', projectId: null, parentId: 'top' },
  { id: 'sub2', projectId: null, parentId: 'sub' },
  { id: 'other', projectId: 'p2' }
]

test('顶层开着 → 它自己和所有子 Frame 都算开着', () => {
  assert.equal(teamModeOf(frames, 'top'), true)
  assert.equal(teamModeOf(frames, 'sub'), true)
  assert.equal(teamModeOf(frames, 'sub2'), true, '隔一层也要继承')
})

test('没设过 = 关。**默认不开**，会花钱的能力不能靠默认值放行', () => {
  assert.equal(teamModeOf(frames, 'other'), false)
})

test('frameId 是 null 或查不到 → false，绝不因为「查不到」就放行', () => {
  assert.equal(teamModeOf(frames, null), false)
  assert.equal(teamModeOf(frames, '不存在'), false)
})

test('子 Frame 上自己带 teamMode 也不算数 —— 只认顶层那个', () => {
  const f = [
    { id: 'top', projectId: 'p1', teamMode: false },
    { id: 'sub', projectId: null, parentId: 'top', teamMode: true }
  ]
  assert.equal(teamModeOf(f, 'sub'), false, '子 Frame 不该有自己的一套设置')
})

test('开关写到顶层：在子 Frame 上点，目标是它爹', () => {
  assert.equal(teamModeTargetId(frames, 'sub2'), 'top')
  assert.equal(teamModeTargetId(frames, 'top'), 'top')
})

test('parentId 成环时不死循环（防御既有数据被改坏）', () => {
  const looped = [
    { id: 'a', projectId: null, parentId: 'b' },
    { id: 'b', projectId: null, parentId: 'a' }
  ]
  assert.equal(teamModeOf(looped, 'a'), false)
  assert.ok(topFrameOf(looped, 'a') !== undefined)
})
