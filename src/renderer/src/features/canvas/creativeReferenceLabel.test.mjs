import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { usesZh } from '../../../../shared/i18n/testKeys.ts'
import { zh } from '../../../../shared/i18n/zh.ts'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')

test('画布开关、浮动面板与独立视图使用创作参考名称和用途提示', () => {
  // 迁移到词典后：源码用的键，其中文必须仍是这些原文（testKeys.ts）
  const toggle = read('./DictBubbleToggle.tsx')
  assert.ok(usesZh(toggle, '收起创作参考', true))
  assert.ok(usesZh(toggle, '查找预设提示词、浏览蓝图，挑选设计风格', true))
  assert.ok(usesZh(toggle, '创作参考', true))
  assert.ok(usesZh(read('./CanvasDictBubble.tsx'), '创作参考', true))
  assert.ok(usesZh(read('../dict/DictView.tsx'), '创作参考', true))
  // PaneView 按类型拼键：settings.pane.kind.${kind}，dict 这一项的中文必须是「创作参考」
  const pane = read('../workspace/PaneView.tsx')
  assert.match(pane, /kind: 'dict'/)
  assert.ok(pane.includes('settings.pane.kind.${kind}'))
  assert.equal(zh['settings.pane.kind.dict'], '创作参考')
  // 候选分类与引用种类也按类型拼键
  assert.ok(read('../agentChat/composerCandidates.ts').includes('chat.cat.${c}'))
  assert.equal(zh['chat.cat.dict'], '创作参考')
  assert.ok(read('../agentChat/composerReferences.ts').includes('chat.ref.${kind}'))
  assert.equal(zh['chat.ref.dict'], '创作参考')
  assert.ok(usesZh(read('../agentChat/SlashPicker.tsx'), '全部创作参考'))
})
