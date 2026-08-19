import { test } from 'node:test'
import assert from 'node:assert/strict'
import { briefFor } from './brief.ts'

const base = { role: 'api-reviewer', goal: '把这块审清楚', task: '读 src/api 下所有接口' }

test('任务排在纪律前面', () => {
  const s = briefFor(base)
  // 一段长约定放在前面会把真正要做的事挤出注意力窗口。首条消息里开头是最强的位置，
  // 任务必须占住它 —— 这条测的是顺序，不是「包含」
  assert.ok(s.indexOf(base.task) < s.indexOf('## 产出'), '任务应该出现在产出约定之前')
  assert.ok(s.indexOf(base.task) < s.indexOf('两条硬约定'), '任务应该出现在硬约定之前')
})

test('产出路径用的是它自己的角色名', () => {
  const s = briefFor(base)
  assert.ok(s.includes('.plans/api-reviewer/'), '要指到自己的目录')
  assert.ok(s.includes('.plans/api-reviewer/findings.md'), '收尾那句也要指到自己的 findings')
})

test('角色名换了，路径跟着换 —— 不能有写死的目录', () => {
  const s = briefFor({ ...base, role: 'perf-auditor' })
  assert.ok(s.includes('.plans/perf-auditor/'))
  assert.ok(!s.includes('api-reviewer'), '不该残留上一个角色')
  // 写死一个目录名的后果是所有 agent 往同一个地方写，互相覆盖且无人报错
  assert.ok(!s.includes('.plans/researcher/'), '不该有硬编码的角色目录')
})

test('目标和任务都带过去了', () => {
  const s = briefFor(base)
  assert.ok(s.includes(base.goal), '要让它知道自己这块在整体里的位置')
  assert.ok(s.includes(base.task))
})

test('「不能再派活」必须在简报里', () => {
  // mcpHandler 里那道硬拦是最后一道闸，但只有硬拦而不提前告知的话，
  // agent 会先白试一次、拿到一个报错、再自己想办法绕 —— 那一轮是纯浪费
  const s = briefFor(base)
  assert.ok(s.includes('team_spawn'), '要点名那个工具，不能只说「别派活」')
  assert.ok(s.includes('不能再派活'))
})

test('BLOCKED 的出口写清楚了', () => {
  // 没有出口的话，卡住的 agent 只有两条路：静默跳过，或者编一个答案。
  // 两者都比「明说没做成」糟糕得多
  const s = briefFor(base)
  assert.ok(s.includes('## BLOCKED'))
  assert.ok(s.includes('不要静默跳过'))
})

test('结论三要素齐全（判据 / 证据 / 边界）', () => {
  const s = briefFor(base)
  for (const k of ['判据', '证据', '边界']) {
    assert.ok(s.includes(`**${k}**`), `缺了「${k}」`)
  }
})
