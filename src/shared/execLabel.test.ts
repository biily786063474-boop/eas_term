import { test } from 'node:test'
import assert from 'node:assert/strict'
import { localizeExecLabelWith } from './execLabel.ts'

const en = (k: string, p?: Record<string, string>): string =>
  ({ 'chat.exec.run': `Run ${p?.target}`, 'chat.exec.edit': `Edit ${p?.target}`, 'chat.exec.read': `Read ${p?.target}`, 'chat.exec.editFiles': 'Edit files', 'chat.exec.create': 'Create' })[k] ?? k

test('前缀与固定标签按传入的翻译函数翻；认不出的原样返回', () => {
  assert.equal(localizeExecLabelWith('运行 npm test', en), 'Run npm test')
  assert.equal(localizeExecLabelWith('读取 a.md', en), 'Read a.md')
  assert.equal(localizeExecLabelWith('编辑 b.ts', en), 'Edit b.ts')
  assert.equal(localizeExecLabelWith('修改文件', en), 'Edit files')
  assert.equal(localizeExecLabelWith('mcp__eas-term__canvas_open_html', en), 'mcp__eas-term__canvas_open_html')
})

test('审批卡片的「修改 <文件>」也翻（之前英文界面的审批卡会漏中文）', () => {
  const en = (k: string, p?: Record<string, string>) => (k === 'chat.exec.edit' ? `Edit ${p?.target}` : k)
  assert.equal(localizeExecLabelWith('修改 a.ts', en), 'Edit a.ts')
})
