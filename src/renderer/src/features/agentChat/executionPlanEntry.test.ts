import { test } from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { transformSync } from 'esbuild'
import { usesZh } from '../../../../shared/i18n/testKeys.ts'

// node --test loads .ts but not .tsx; transpile the real component, not a rewritten fixture.
const source = readFileSync(new URL('./ExecutionPlanEntry.tsx', import.meta.url), 'utf8')
const compiled = transformSync(source, { loader: 'tsx', format: 'cjs', jsx: 'transform', jsxFactory: 'React.createElement' }).code
const module: { exports: Record<string, React.ComponentType<any>> } = { exports: {} }
runInNewContext(compiled, { module, exports: module.exports, React })
const { ExecutionPlanEntry, PlanMissingNotice } = module.exports

test('plan summary exposes progress, current step and keyboard button', () => {
  const html = renderToStaticMarkup(React.createElement(ExecutionPlanEntry, { summary: { planId: 'p', done: 2, total: 5, currentTitle: '验证', version: 3 }, onOpen() {} }))
  assert.match(html, /2\/5/)
  assert.match(html, /验证/)
  assert.match(html, /aria-label="查看执行清单/)
  assert.match(html, /<button/)
})

test('missing plan copy distinguishes execution and only offers a draft action', () => {
  const neutral = renderToStaticMarkup(React.createElement(PlanMissingNotice, { state: 'neutral', onDraft() {} }))
  const executed = renderToStaticMarkup(React.createElement(PlanMissingNotice, { state: 'executed', onDraft() {} }))
  assert.match(neutral, /本轮未建立执行清单/)
  assert.match(executed, /已执行但未建清单/)
  assert.match(executed, /让 AI 补建/)
})

test('panel shows model completion without manual acceptance and preserves details/retry', () => {
  const panel = readFileSync(new URL('../../../../../resources/plugins/execution-plan/ui/panel.html', import.meta.url), 'utf8')
  assert.match(panel, /✓ 已完成/)
  assert.doesNotMatch(panel, /待验收|已验收|data-accept/)
  assert.match(panel, /展开全部步骤/)
  assert.match(panel, /data-retry>重试/)
  assert.doesNotMatch(panel, /rpc\('panel\/accept/)
  assert.match(panel, /panel\/update/)
  assert.match(panel, /panel\/archive/)
  const hostPanel = readFileSync(new URL('../plugins/PluginPanel.tsx', import.meta.url), 'utf8')
  assert.match(hostPanel, /state\.k === 'error'/)
  assert.ok(usesZh(hostPanel, '重试'), '插件面板出错时仍有「重试」')
})
