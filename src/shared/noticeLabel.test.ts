import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isBackgroundNotice,
  noticeStatusText,
  noticeDockTag,
  noticeGroupTitle,
  islandBarLabel
} from './noticeLabel.ts'

const done = { kind: 'done' as const }
const appr = { kind: 'approval' as const }
const bg = { kind: 'done' as const, background: 'npm run build' }
const bgNoName = { kind: 'done' as const, background: '' }

test('后台运行中是 done 的一个变体：行为照 done，只换字', () => {
  assert.equal(isBackgroundNotice(bg), true)
  assert.equal(isBackgroundNotice(bgNoName), true)
  assert.equal(isBackgroundNotice(done), false)
  // 审批上即使带了残留字段也不算后台运行中——审批永远最急
  assert.equal(isBackgroundNotice({ kind: 'approval', background: 'x' }), false)
})

test('卡片状态字：等待审批 / 后台运行中 / 已完成', () => {
  assert.equal(noticeStatusText(appr), '等待审批')
  assert.equal(noticeStatusText(bg), '后台运行中')
  assert.equal(noticeStatusText(done), '已完成')
})

test('Dock 菜单标签：后台运行中带任务名，没名字就不带', () => {
  assert.equal(noticeDockTag(appr), '等审批')
  assert.equal(noticeDockTag(done), '已完成')
  assert.equal(noticeDockTag(bg), '后台运行中 · npm run build')
  assert.equal(noticeDockTag(bgNoName), '后台运行中')
})

test('列表组标题：没有后台运行中时保持原文案', () => {
  assert.equal(noticeGroupTitle([done, appr]), '完成了 2 个')
})

test('列表组标题：全是后台运行中 → 不说「完成了」', () => {
  assert.equal(noticeGroupTitle([bg, bgNoName]), '后台运行中 2 个')
})

test('列表组标题：混合 → 两件事都说', () => {
  assert.equal(noticeGroupTitle([done, bg, appr]), '完成了 2 个 · 后台运行中 1 个')
})

test('折叠条：只有后台运行中的通知时不说「任务完成」', () => {
  assert.equal(islandBarLabel({ waiting: false, runN: 0, doneN: 0, bgN: 1 }), '后台运行中')
  assert.equal(islandBarLabel({ waiting: false, runN: 0, doneN: 1, bgN: 1 }), '任务完成')
  assert.equal(islandBarLabel({ waiting: true, runN: 2, doneN: 1, bgN: 1 }), '需要审批')
  assert.equal(islandBarLabel({ waiting: false, runN: 1, doneN: 0, bgN: 1 }), '工作中')
  assert.equal(islandBarLabel({ waiting: false, runN: 0, doneN: 0, bgN: 0 }), '待处理')
})
