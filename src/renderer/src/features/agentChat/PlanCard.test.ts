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

test('compact card distinguishes pending, reported and user-accepted steps', () => {
  const html = renderToStaticMarkup(React.createElement(PlanCardContent, { card, busy: false, onAccept() {}, onStop() {}, onDetails() {} }))
  assert.match(html, /定位/)
  assert.match(html, /待验收/)
  assert.match(html, /已验收/)
  assert.match(html, /aria-pressed="true"/)
  assert.match(html, /终止本次任务/)
  assert.match(html, /查看详情/)
})

test('fully accepted but busy remains visible waiting for turn end', () => {
  const html = renderToStaticMarkup(React.createElement(PlanCardContent, { card: { ...card, steps: card.steps.map(step => ({ ...step, accepted: true })) }, busy: true, onAccept() {}, onStop() {}, onDetails() {} }))
  assert.match(html, /等待当前轮结束/)
})

test('old message-list entry is gone but missing-plan notice remains', () => {
  const list = readFileSync(new URL('./MessageList.tsx', import.meta.url), 'utf8')
  assert.doesNotMatch(list, /<ExecutionPlanEntry/)
  assert.match(list, /<PlanMissingNotice/)
})
