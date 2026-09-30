import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { vaultStateForUse } from './vaultCheck.ts'

const st = (o: Record<string, unknown>) =>
  ({ available: null, configured: true, locked: false, trustedDevice: true, count: 1, foreign: false, lockedOutMs: 0, ...o }) as never

test('信任设备首用验证失败：展示态说已解锁，真状态锁着 → 要弹解锁（不白跑一次）', async () => {
  let displayCalls = 0
  const api = {
    status: async () => { displayCalls++; return st({ locked: false }) },
    checkStatus: async () => st({ locked: true, trustedDevice: false, available: false })
  }
  const r = await vaultStateForUse(api)
  assert.equal(r.needsUnlock, true)
  assert.equal(displayCalls, 0, '不许拿展示态做决定')
})

test('真检查通过 → 不弹；未启用 → 弹', async () => {
  assert.equal((await vaultStateForUse({ checkStatus: async () => st({}) })).needsUnlock, false)
  assert.equal((await vaultStateForUse({ checkStatus: async () => st({ configured: false, locked: true }) })).needsUnlock, true)
})

test('源码钉：secret_check 与 JEV 验证连接先走真检查再决定是否弹解锁', () => {
  const mcp = fs.readFileSync(new URL('../../mcpHandler.ts', import.meta.url), 'utf8')
  const sc = mcp.slice(mcp.indexOf("tool === 'secret_check'"), mcp.indexOf("tool === 'report_secret_invalid'"))
  const gate = sc.slice(0, sc.indexOf('askForSecret('))
  assert.match(gate, /vaultStateForUse\(window\.api\.secrets\)/)
  assert.doesNotMatch(gate, /secrets\.status\(\)/)
  const panel = fs.readFileSync(new URL('../plugins/PluginPanel.tsx', import.meta.url), 'utf8')
  const at = panel.indexOf("action==='connect'")
  assert.ok(at > 0, '找不到 JEV connect 分支')
  const jev = panel.slice(at, panel.indexOf('plugins.panelRpc(state.session, r.method', at))
  assert.match(jev, /vaultStateForUse\(window\.api\.secrets\)/)
  assert.doesNotMatch(jev, /secrets\.status\(\)/)
})
