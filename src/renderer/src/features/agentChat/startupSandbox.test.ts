import { test } from 'node:test'
import assert from 'node:assert/strict'
import { startupSandboxParams } from './startupSandbox.ts'

test('Codex 启动页默认完全放开，显式权限进入启动参数', () => {
  assert.deepEqual(startupSandboxParams('codex'), { sandbox: 'danger-full-access' })
  for (const sandbox of ['read-only', 'workspace-write', 'danger-full-access']) {
    assert.deepEqual(startupSandboxParams('codex', sandbox), { sandbox })
  }
})
test('只读角色覆盖完全放开；无效值不能传入 CLI', () => {
  assert.deepEqual(startupSandboxParams('codex', 'danger-full-access', true), { sandbox: 'read-only' })
  assert.deepEqual(startupSandboxParams('codex', 'invalid'), { sandbox: 'workspace-write' })
})
test('切换到 Claude 或 omp 不携带 Codex 沙箱权限', () => {
  for (const cli of ['claude', 'omp', undefined]) {
    assert.deepEqual(startupSandboxParams(cli, 'danger-full-access'), {})
  }
})
