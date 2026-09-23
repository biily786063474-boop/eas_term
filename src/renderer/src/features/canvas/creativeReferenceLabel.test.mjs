import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')

test('画布开关、浮动面板与独立视图使用创作参考名称和用途提示', () => {
  const toggle = read('./DictBubbleToggle.tsx')
  assert.match(toggle, /data-tip=\{open \? '收起创作参考' : '查找预设提示词、浏览蓝图，挑选设计风格'\}/)
  assert.match(toggle, />\s*创作参考\s*<\/button>/)
  assert.match(read('./CanvasDictBubble.tsx'), /<span>创作参考<\/span>/)
  assert.match(read('../dict/DictView.tsx'), /className="dict-title">创作参考<\/span>/)
  const pane = read('../workspace/PaneView.tsx')
  assert.match(pane, /kind: 'dict', label: '创作参考'/)
  assert.match(pane, /dict: \{ label: '创作参考'/)
  assert.match(read('../agentChat/composerCandidates.ts'), /dict:'创作参考'/)
  assert.match(read('../agentChat/composerReferences.ts'), /dict: '创作参考'/)
  assert.match(read('../agentChat/SlashPicker.tsx'), /全部创作参考/)
})
