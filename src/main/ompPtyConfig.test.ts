import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ompBaseEnv, ompAgentDir, ompBinPath } from './agentChat/omp/paths.ts'
import { writeOmpSetup } from './agentChat/omp/store.ts'
import { prepareOmpPtyConfig } from './ompPtyConfig.ts'
import type { HostPaths } from '../shared/agentChat.ts'
test('OMP retains the explicitly managed absolute agent directory after inherited values are scrubbed', () => {
  const host = { isPackaged: false, appPath: '/app', resourcesPath: '', userData: '/managed', home: '/home' }
  assert.equal(ompBaseEnv(host).PI_CODING_AGENT_DIR, ompAgentDir(host.userData))
})
test('PTY OMP prepares same app-owned config before launch and returns only directory routing, never main secrets', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omp pty配置 ')); t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const host: HostPaths = { isPackaged: false, appPath: root, resourcesPath: '', userData: path.join(root, 'managed'), home: path.join(root, 'home') }
  const binary = ompBinPath(host); fs.mkdirSync(path.dirname(binary), { recursive: true }); fs.writeFileSync(binary, 'fixture')
  fs.mkdirSync(host.home); fs.mkdirSync(path.join(host.home, '.omp')); fs.writeFileSync(path.join(host.home, '.omp', 'keep'), 'user-auth-preserved')
  writeOmpSetup(host.userData, { approvalMode: 'always-ask' })
  const env = prepareOmpPtyConfig(host, binary, ['--print'], false)
  assert.equal(env.PI_CODING_AGENT_DIR, ompAgentDir(host.userData))
  assert.deepEqual(Object.keys(env).sort(), ['HOME', 'OMP_SKIP_SETUP', 'PI_CODING_AGENT_DIR', 'PI_CONFIG_DIR'])
  assert.match(fs.readFileSync(path.join(ompAgentDir(host.userData), 'config.yml'), 'utf8'), /approvalMode: "always-ask"/)
  assert.equal(fs.readFileSync(path.join(host.home, '.omp', 'keep'), 'utf8'), 'user-auth-preserved')
  assert.throws(() => prepareOmpPtyConfig(host, process.execPath, [], false), /随包/)
  for (const args of [['--profile', 'custom'], ['--profile=custom'], ['--session-dir', '/outside']]) assert.throws(() => prepareOmpPtyConfig(host, binary, args, false), /目录/)
})
