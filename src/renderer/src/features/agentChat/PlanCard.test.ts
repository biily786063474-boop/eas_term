import { test } from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { transformSync } from 'esbuild'

const source = readFileSync(new URL('./PlanCard.tsx', import.meta.url), 'utf8')
const compiled = transformSync(source, { loader: 'tsx', format: 'cjs', jsx: 'transform', jsxFactory: 'React.createElement' }).code
const module: { exports: Record<string, React.ComponentType<any>> } = { exports: {} }
runInNewContext(compiled, { module, exports: module.exports, require: (name: string) => name === 'react' ? React : undefined, React })
const { PlanCardContent } = module.exports
const card = { planId: 'p', title: '字幕同步', status: 'active', version: 4, steps: [
  { stepId: 'a', title: '定位', status: 'pending', accepted: false },
  { stepId: 'b', title: '修复', status: 'reported_done', accepted: false },
  { stepId: 'c', title: '验证', status: 'reported_done', accepted: true }
] }

test('model completion checks steps without a user acceptance button', () => {
  const html = renderToStaticMarkup(React.createElement(PlanCardContent, { card, busy: false, onAccept() {}, onStop() {}, onDetails() {} }))
  assert.match(html, /定位/)
  assert.match(html, /2\/3/)
  assert.match(html, /已完成/)
  assert.doesNotMatch(html, /验收|aria-pressed/)
  assert.match(html, /终止本次任务/)
  assert.match(html, /查看详情/)
})

test('fully accepted but busy remains visible waiting for turn end', () => {
  const html = renderToStaticMarkup(React.createElement(PlanCardContent, { card: { ...card, steps: card.steps.map(step => ({ ...step, status: 'reported_done', accepted: false })) }, busy: true, onAccept() {}, onStop() {}, onDetails() {} }))
  assert.match(html, /等待当前轮结束/)
})

test('expanded card has an explicit collapse control', () => {
  const html = renderToStaticMarkup(React.createElement(PlanCardContent, { card, busy: true, onAccept() {}, onStop() {}, onDetails() {}, onCollapse() {} }))
  assert.match(html, /aria-label="收起执行清单"/)
})

test('old message-list entry is gone but missing-plan notice remains', () => {
  const list = readFileSync(new URL('./MessageList.tsx', import.meta.url), 'utf8')
  assert.doesNotMatch(list, /<ExecutionPlanEntry/)
  assert.match(list, /<PlanMissingNotice/)
})

test('one ring per task; completion follows main automatic completion semantics', () => {
  const html = renderToStaticMarkup(React.createElement(module.exports.PlanTaskRings, { card, busy: true }))
  assert.equal((html.match(/class="ac-plan-task-ring /g) || []).length, 3)
  assert.match(html, /is-pending/)
  assert.match(html, /is-reported_done/)
  assert.doesNotMatch(html, /is-accepted/)
  assert.match(html, /已完成/)
  assert.doesNotMatch(html, /验收/)
})

test('only actively running steps rotate; idle and blocked never imply activity', () => {
  const running = { ...card, steps: [{stepId:'a', title:'执行', status:'in_progress', accepted:false}, {stepId:'b',title:'受阻',status:'blocked',accepted:false}] }
  const active = renderToStaticMarkup(React.createElement(module.exports.PlanTaskRings, { card: running, busy: true }))
  const idle = renderToStaticMarkup(React.createElement(module.exports.PlanTaskRings, { card: running, busy: false }))
  assert.equal((active.match(/is-spinning/g) || []).length, 1)
  assert.doesNotMatch(idle, /is-spinning/)
})
