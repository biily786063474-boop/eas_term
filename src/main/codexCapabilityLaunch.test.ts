import { test } from 'node:test'
import assert from 'node:assert/strict'
import { codexCapabilityLaunch } from './codexCapabilityLaunch.ts'

test('managed Codex launch retains exact native argv and packaged paths with spaces', () => {
  const argv = ['exec', '--json', '-c', 'instructions=角色规则', '用户消息\n第二行']
  const launch = codexCapabilityLaunch('/CLI 路径/codex', argv, {
    isPackaged: true, appPath: '/app', resourcesPath: '/软件 路径/Resources', electron: '/软件 路径/Eas-Term', platform: 'win32'
  })
  assert.equal(launch.command, '/软件 路径/Eas-Term')
  assert.equal(launch.args[0], '/软件 路径/Resources/mcp/eas-codex-launcher.mjs')
  assert.deepEqual(JSON.parse(launch.args[1]), { binary: '/CLI 路径/codex', args: argv })
  assert.equal(launch.env?.ELECTRON_RUN_AS_NODE, '1')
  assert.equal(launch.env?.EAS_CAPABILITY_NODE_FALLBACK, '1')
})
