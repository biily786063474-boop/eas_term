import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveInstallCommand } from './installCommand.ts'

// S1（2026-09-14 评审）：安装命令由主进程从 installPlan 查表，渲染层传来的字符串只能用来
// "选"方案表里的某一条，不在表里的一律拒绝——不再把界面回传的字符串直接交给 shell。
const plan = { claude: { options: [{ via: 'npm', cmd: 'npm install -g @anthropic-ai/claude-code' }, { via: '脚本', cmd: 'curl -fsSL https://claude.ai/install.sh | bash' }] }, codex: { options: [] } } as const

test('不传就取第一条；传了必须逐字命中方案表', () => {
  const a = resolveInstallCommand(plan, 'claude', undefined)
  assert.deepEqual(a, { ok: true, cmd: 'npm install -g @anthropic-ai/claude-code' })
  const r = resolveInstallCommand(plan, 'claude', 'curl -fsSL https://claude.ai/install.sh | bash')
  assert.deepEqual(r, { ok: true, cmd: 'curl -fsSL https://claude.ai/install.sh | bash' })
})
test('不在表里的字符串、拼接过的字符串、未知 CLI、空方案表：一律拒绝且不返回任何命令', () => {
  for (const bad of ['echo hacked', 'npm install -g @anthropic-ai/claude-code; rm -rf ~', ' npm install -g @anthropic-ai/claude-code']) {
    const r = resolveInstallCommand(plan, 'claude', bad); assert.equal(r.ok, false); assert.ok(!('cmd' in r))
  }
  assert.equal(resolveInstallCommand(plan, 'codex', undefined).ok, false)
  assert.equal(resolveInstallCommand(plan, 'gemini' as never, undefined).ok, false)
})
