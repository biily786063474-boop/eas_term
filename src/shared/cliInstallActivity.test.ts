import assert from 'node:assert/strict'
import { test } from 'node:test'
import { installActivity } from './cliInstallActivity.ts'

test('安装中显示真实的最新三条输出，不编造阶段或百分比', () => {
  const result = installActivity({cli:'codex',phase:'running',step:'Installing',output:['Resolving version','Downloading','Installing'],updatedAt:1000}, 2000)
  assert.equal(result.stage, '安装器运行中')
  assert.deepEqual(result.recent, ['Resolving version','Downloading','Installing'])
  assert.equal(result.stalled, false)
})

test('30 秒无新输出时说明停在何时，验证阶段另标明', () => {
  const running = installActivity({cli:'claude',phase:'running',step:'Downloading',output:['Downloading'],updatedAt:1000}, 32000)
  assert.equal(running.stalled, true)
  assert.equal(running.secondsSinceOutput, 31)
  const checking = installActivity({cli:'claude',phase:'verifying',output:[]}, 32000)
  assert.equal(checking.stage, '验证安装结果')
})
