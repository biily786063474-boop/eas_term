import assert from 'node:assert/strict'
import { test } from 'node:test'

import { bindRole, globMatch, IMAGE_MCP_PATTERNS, CLAUDE_WRITE_TOOLS, OMP_WRITE_TOOLS } from './roleBinding.ts'

test('globMatch：只认 *，大小写不敏感，其余字符字面匹配', () => {
  assert.ok(globMatch('*image*', 'my-Image-gen'))
  assert.ok(globMatch('bizone-canvas', 'bizone-canvas'))
  assert.ok(!globMatch('bizone-canvas', 'bizone-canvas-2'))
  assert.ok(!globMatch('a.b', 'aXb'), '. 不能当正则用')
})

test('空卡 = 什么都不加，三家都没有报告行', () => {
  for (const k of ['claude', 'codex', 'omp'] as const) {
    const b = bindRole(undefined, k)
    assert.deepEqual(b.claude.deny, [])
    assert.deepEqual(b.codex, { disable: [], disableServers: [], sandbox: undefined })
    assert.deepEqual(b.omp, { removeTools: [], dropServers: [], dropServerPatterns: [] })
    assert.deepEqual(b.report, [])
  }
})

test('write:false —— Claude 去三个写工具，Codex 只读沙箱，omp 去 write/edit/ast_edit', () => {
  const bounds = { caps: { write: false as const } }
  const c = bindRole(bounds, 'claude')
  assert.deepEqual(c.claude.deny, CLAUDE_WRITE_TOOLS)
  assert.equal(c.report[0].level, 'hard')
  assert.ok(c.report[0].how.includes('Bash'), '没提醒 Bash 仍能写')
  const x = bindRole(bounds, 'codex')
  assert.equal(x.codex.sandbox, 'read-only')
  assert.equal(x.report[0].level, 'hard')
  const o = bindRole(bounds, 'omp')
  assert.deepEqual(o.omp.removeTools, OMP_WRITE_TOOLS)
})

test('write:false + shell:false 时 Claude 的提醒不再提 Bash', () => {
  const b = bindRole({ caps: { write: false, shell: false } }, 'claude')
  const line = b.report.find((l) => l.cap === 'write')!
  assert.ok(!line.how.includes('Bash'))
})

test('shell:false —— Claude 去 Bash，Codex --disable shell_tool，omp 去 bash', () => {
  const bounds = { caps: { shell: false as const } }
  assert.deepEqual(bindRole(bounds, 'claude').claude.deny, ['Bash'])
  assert.deepEqual(bindRole(bounds, 'codex').codex.disable, ['shell_tool'])
  assert.deepEqual(bindRole(bounds, 'omp').omp.removeTools, ['bash'])
})

test('imageGen:false —— Claude 通配 deny；Codex 关内置生图（degraded）并按名关 server；omp 只按名关 server', () => {
  const bounds = { caps: { imageGen: false as const } }
  const c = bindRole(bounds, 'claude')
  assert.deepEqual(c.claude.deny, IMAGE_MCP_PATTERNS.map((p) => `mcp__${p}`))
  const x = bindRole(bounds, 'codex', { knownMcpServers: ['eas-term', 'flux-server'] })
  assert.deepEqual(x.codex.disable, ['image_generation'])
  assert.deepEqual(x.codex.disableServers, ['flux-server'])
  assert.ok(x.report.every((l) => l.level === 'degraded'))
  const o = bindRole(bounds, 'omp')
  assert.deepEqual(o.omp.dropServerPatterns, IMAGE_MCP_PATTERNS)
  assert.equal(o.report[0].level, 'degraded')
})

test('mcp.denyServers —— Codex 按 knownMcpServers 过滤，名字不存在会让它拒绝启动', () => {
  const bounds = { caps: { mcp: { denyServers: ['bizone-canvas', '手误'] } } }
  assert.deepEqual(bindRole(bounds, 'claude').claude.deny, ['mcp__bizone-canvas__*', 'mcp__手误__*'])
  assert.deepEqual(bindRole(bounds, 'codex', { knownMcpServers: ['bizone-canvas'] }).codex.disableServers, ['bizone-canvas'])
  assert.deepEqual(bindRole(bounds, 'codex').codex.disableServers, ['bizone-canvas', '手误'], '没给清单时不过滤（调用方负责）')
  assert.deepEqual(bindRole(bounds, 'omp').omp.dropServers, ['bizone-canvas', '手误'])
})

test('mcp.denyTools —— Claude 直接通配；Codex/omp 降级为按 server 名匹配', () => {
  const bounds = { caps: { mcp: { denyTools: ['*canvas*'] } } }
  assert.deepEqual(bindRole(bounds, 'claude').claude.deny, ['mcp__*canvas*'])
  const x = bindRole(bounds, 'codex', { knownMcpServers: ['bizone-canvas', 'eas-term'] })
  assert.deepEqual(x.codex.disableServers, ['bizone-canvas'])
  assert.equal(x.report[0].level, 'degraded')
  assert.deepEqual(bindRole(bounds, 'omp').omp.dropServerPatterns, ['*canvas*'])
})

test('raw 只落到自己那家，报告标 raw', () => {
  const bounds = { raw: { claude: { deny: ['WebFetch'] }, codex: { disable: ['web_search'] }, omp: { removeTools: ['web_search'] } } }
  assert.deepEqual(bindRole(bounds, 'claude').claude.deny, ['WebFetch'])
  assert.deepEqual(bindRole(bounds, 'codex').codex.disable, ['web_search'])
  assert.deepEqual(bindRole(bounds, 'omp').omp.removeTools, ['web_search'])
  assert.equal(bindRole(bounds, 'claude').report[0].cap, 'raw')
})

test('deny 去重：write:false 又在 raw 里写了 Write，只出现一次', () => {
  const b = bindRole({ caps: { write: false }, raw: { claude: { deny: ['Write'] } } }, 'claude')
  assert.equal(b.claude.deny.filter((x) => x === 'Write').length, 1)
})

test('**每条参数都有对应报告行** —— 报告是绑定的副产物，不是另写的说明', () => {
  const bounds = { caps: { write: false as const, shell: false as const, imageGen: false as const, mcp: { denyServers: ['s'], denyTools: ['*t*'] } }, raw: { claude: { deny: ['X'] } } }
  const c = bindRole(bounds, 'claude', { knownMcpServers: ['s'] })
  assert.equal(c.report.length, 6) // write shell imageGen mcpServers mcpTools raw
  const x = bindRole(bounds, 'codex', { knownMcpServers: ['s'] })
  assert.equal(x.report.length, 5) // raw.claude 不在 codex 上
  const o = bindRole(bounds, 'omp')
  assert.equal(o.report.length, 5)
})
