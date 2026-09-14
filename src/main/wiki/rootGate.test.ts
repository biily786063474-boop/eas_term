import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createWikiRootGate } from './rootGate.ts'

// S3：wiki:init / wiki:setPath 只接受主进程自己对话框（或默认建议）返回过的路径，
// 或 guardDir 允许的目录；渲染层随手传一个绝对路径不能再让主进程去那里建目录写文件。
test('对话框返回过的路径放行；guardDir 允许的放行；其余拒绝', () => {
  const gate = createWikiRootGate({ guardDir: p => ({ ok: p.startsWith('/allowed/') }) })
  assert.equal(gate.allowed('/tmp/anything'), false)
  gate.remember('/Users/me/Documents/eas-wiki')
  assert.equal(gate.allowed('/Users/me/Documents/eas-wiki'), true)
  assert.equal(gate.allowed('/Users/me/Documents/eas-wiki/../other'), false, '归一化后不同就不算')
  assert.equal(gate.allowed('/allowed/proj/wiki'), true)
  gate.remember(null); assert.equal(gate.allowed(''), false)
})
