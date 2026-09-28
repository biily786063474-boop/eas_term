import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildPtyCapabilityCommand, capabilityInvocationCwd } from './capabilityPtyCommand.ts'
const host = { isPackaged: true, appPath: '/app', resourcesPath: '/包 路径', electron: '/app/electron', platform: 'win32' as const }
const cap = { servers: [{ name: 'eas-term', command: '/node', args: ['/shim'], envVars: ['EAS_CAPABILITY_LEASE'] }], configPath: '/会话 快照/config.json', guidance: '内置指引' }
test('PTY current directory follows native cwd option without mutating argv', () => {
  const args = ['--cd', '../项目 二', 'resume', 'thread']
  assert.equal(capabilityInvocationCwd({ kind: 'codex', binary: '/codex', cwd: '/根/项目 一', args }), '/根/项目 二')
  assert.deepEqual(args, ['--cd', '../项目 二', 'resume', 'thread'])
  assert.equal(capabilityInvocationCwd({ kind: 'omp', binary: '/omp', cwd: '/根', args: ['--cwd=子项目'] }), '/根/子项目')
  assert.equal(capabilityInvocationCwd({ kind: 'codex', binary: '/codex', cwd: '/根', args: ['-C子项目'] }), '/根/子项目')
})
test('Claude appends its short guidance without replacing user instructions or strictness', () => {
  const args = ['--append-system-prompt', '用户规则\n第二行', '--resume', 'thread']
  const result = buildPtyCapabilityCommand({ kind: 'claude', binary: '/claude', cwd: '/project', args }, cap, host)
  assert.deepEqual(result.args, ['--allowedTools', 'mcp__eas-term__canvas_publish_report', '--mcp-config', cap.configPath, '--append-system-prompt', '用户规则\n第二行\n\n内置指引', '--resume', 'thread'])
  assert.equal(args[1], '用户规则\n第二行')
  assert.ok(!result.args.includes('--strict-mcp-config'))
})
test('Codex uses the owned preserving preflight and keeps native resume arguments', () => {
  const result = buildPtyCapabilityCommand({ kind: 'codex', binary: '/codex', cwd: '/project', args: ['resume', 'thread'] }, cap, host)
  const input = JSON.parse(result.args[1])
  assert.deepEqual(input.args.slice(-2), ['resume', 'thread'])
  assert.ok(input.managedAssignments.includes('mcp_servers.eas-term.env_vars=["EAS_CAPABILITY_LEASE"]'))
})
test('Claude pre-approves only publish_report, placed so the variadic flag cannot swallow user args', () => {
  // 2026-09-28：自动模式把「汇报页提交到画布」拦下。实测 `--allowedTools` 是变长参数，
  // 后面直接跟提问文字会被吞成工具名，所以必须紧跟另一个选项。
  const args = ['帮我出一份汇报页']
  const result = buildPtyCapabilityCommand({ kind: 'claude', binary: '/claude', cwd: '/project', args }, cap, host)
  assert.deepEqual(result.args.slice(0, 4), ['--allowedTools', 'mcp__eas-term__canvas_publish_report', '--mcp-config', cap.configPath])
  assert.equal(result.args.at(-1), '帮我出一份汇报页')
  assert.equal(result.args.filter(a => a.startsWith('mcp__')).length, 1, '只放这一个工具')
})
test('No publish_report allow when the workbench server is not in this session', () => {
  const only = { ...cap, servers: [{ name: 'bizone-canvas', command: '/node', args: ['/b'] }] }
  const result = buildPtyCapabilityCommand({ kind: 'claude', binary: '/claude', cwd: '/project', args: [] }, only, host)
  assert.ok(!result.args.includes('--allowedTools'))
})
