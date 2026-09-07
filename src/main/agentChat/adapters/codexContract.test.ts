import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { codexAdapter } from './codex.ts'

const version = spawnSync('codex', ['--version'], { encoding: 'utf8' })
for (const sandbox of ['read-only', 'workspace-write']) {
  test(`Codex resume CLI 契约：${sandbox} 恢复参数可解析`, { skip: version.error?.message.includes('ENOENT') }, () => {
    const { bin, args } = codexAdapter.buildArgs({ cwd: '/private/tmp', resumeId: '00000000-0000-0000-0000-000000000000', sandbox })
    const r = spawnSync(bin, [...args, '--help'], { encoding: 'utf8', timeout: 5000 })
    assert.equal(r.status, 0, r.stderr)
    assert.ok(args.indexOf('--sandbox') < args.indexOf('resume'))
    assert.equal(args[args.indexOf('--sandbox') + 1], sandbox)
  })
}
