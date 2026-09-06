import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  bindRole,
  codexDisableServerArg,
  codexSkillsConfigArg,
  globMatch,
  IMAGE_MCP_PATTERNS,
  CLAUDE_WRITE_TOOLS,
  OMP_WRITE_TOOLS,
  capMatrix,
  degradedLines,
  CAP_LABEL,
  HARNESS_LABEL,
  HARNESSES,
  LEVEL_LABEL
} from './roleBinding.ts'

test('globMatch：只认 *，大小写不敏感，其余字符字面匹配', () => {
  assert.ok(globMatch('*image*', 'my-Image-gen'))
  assert.ok(globMatch('bizone-canvas', 'bizone-canvas'))
  assert.ok(!globMatch('bizone-canvas', 'bizone-canvas-2'))
  assert.ok(!globMatch('a.b', 'aXb'), '. 不能当正则用')
})

test('codexDisableServerArg：字面量收口在一处，adapters/codex.ts 与 CanvasAgentBar 都调它', () => {
  assert.equal(codexDisableServerArg('bizone-canvas'), 'mcp_servers.bizone-canvas.enabled=false')
})

test('空卡 = 什么都不加，三家都没有报告行', () => {
  for (const k of ['claude', 'codex', 'omp'] as const) {
    const b = bindRole(undefined, k)
    assert.deepEqual(b.claude.deny, [])
    assert.deepEqual(b.codex, { disable: [], disableServers: [], skillsOff: [], sandbox: undefined })
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

test('imageGen:false —— Claude 通配 deny；Codex 无 codexHome 时关内置生图（degraded，未摘 skill）并按名关 server；omp 只按名关 server', () => {
  const bounds = { caps: { imageGen: false as const } }
  const c = bindRole(bounds, 'claude')
  assert.deepEqual(c.claude.deny, IMAGE_MCP_PATTERNS.map((p) => `mcp__${p}`))
  const x = bindRole(bounds, 'codex', { knownMcpServers: ['eas-term', 'flux-server'] })
  assert.deepEqual(x.codex.disable, ['image_generation'])
  assert.deepEqual(x.codex.disableServers, ['flux-server'])
  assert.deepEqual(x.codex.skillsOff, [], '没给 codexHome，摘不掉 skill')
  assert.ok(x.report.every((l) => l.level === 'degraded'))
  assert.ok(x.report[0].how.includes('未摘掉 imagegen 系统 skill（这条路径拿不到 Codex 配置目录）'), 'how 要说人话，不能是内部黑话')
  const o = bindRole(bounds, 'omp')
  assert.deepEqual(o.omp.dropServerPatterns, IMAGE_MCP_PATTERNS)
  assert.equal(o.report[0].level, 'degraded')
})

test('imageGen:false × Codex 有 codexHome —— 升级为 hard：摘掉 imagegen 系统 skill，按 SKILL.md 完整路径', () => {
  const bounds = { caps: { imageGen: false as const } }
  const x = bindRole(bounds, 'codex', { knownMcpServers: ['flux-server'], codexHome: '/Users/x/.codex' })
  assert.deepEqual(x.codex.disable, ['image_generation'], '内置 --disable 仍然保留')
  assert.deepEqual(x.codex.disableServers, ['flux-server'])
  assert.deepEqual(x.codex.skillsOff, ['/Users/x/.codex/skills/.system/imagegen/SKILL.md'])
  assert.equal(x.report.length, 1)
  assert.equal(x.report[0].level, 'hard')
  assert.ok(x.report[0].how.includes('摘掉'), 'how 里要说清楚摘了 skill')
  assert.ok(x.report[0].how.includes('整体覆盖你 config.toml 里自己写的 skills.config'), 'how 要提醒这是整体覆盖不是追加')
})

test('imageGen:false × Codex 有 codexHome（Windows 反斜杠路径）—— 按 codexHome 自己的分隔符拼，不写死 /', () => {
  const bounds = { caps: { imageGen: false as const } }
  const x = bindRole(bounds, 'codex', { codexHome: 'C:\\Users\\x\\.codex' })
  assert.deepEqual(x.codex.skillsOff, ['C:\\Users\\x\\.codex\\skills\\.system\\imagegen\\SKILL.md'])
  // 经 codexSkillsConfigArg 转义后要是一段合法的 TOML：反斜杠先转义成两个
  assert.equal(
    codexSkillsConfigArg(x.codex.skillsOff),
    'skills.config=[{path="C:\\\\Users\\\\x\\\\.codex\\\\skills\\\\.system\\\\imagegen\\\\SKILL.md",enabled=false}]'
  )
})

test('codexSkillsConfigArg：TOML 内联表数组，路径含引号与反斜杠要转义', () => {
  assert.equal(
    codexSkillsConfigArg(['/Users/x/.codex/skills/.system/imagegen/SKILL.md']),
    'skills.config=[{path="/Users/x/.codex/skills/.system/imagegen/SKILL.md",enabled=false}]'
  )
  assert.equal(
    codexSkillsConfigArg(['/a/SKILL.md', '/b/SKILL.md']),
    'skills.config=[{path="/a/SKILL.md",enabled=false},{path="/b/SKILL.md",enabled=false}]'
  )
  assert.equal(
    codexSkillsConfigArg(["C:\\Users\\x\\\"weird\"\\SKILL.md"]),
    "skills.config=[{path=\"C:\\\\Users\\\\x\\\\\\\"weird\\\"\\\\SKILL.md\",enabled=false}]"
  )
  assert.equal(codexSkillsConfigArg([]), '', '空数组不该生成清空用户全部 skills.config 的合法参数')
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

test('标签表齐全：六个 cap、三家、四档都有中文名', () => {
  for (const k of ['write', 'shell', 'imageGen', 'mcpServers', 'mcpTools', 'raw'] as const) assert.ok(CAP_LABEL[k])
  assert.deepEqual(HARNESSES, ['claude', 'codex', 'omp'])
  assert.equal(HARNESS_LABEL.omp, '默认 harness')
  for (const l of ['hard', 'soft', 'degraded', 'unsupported'] as const) assert.ok(LEVEL_LABEL[l])
})

test('capMatrix：空卡也给三行预览（write/shell/imageGen），全部 active=false，格子里是「点亮后会怎样」', () => {
  const rows = capMatrix(undefined)
  assert.deepEqual(rows.map((r) => r.cap), ['write', 'shell', 'imageGen'])
  assert.ok(rows.every((r) => !r.active))
  assert.equal(rows[0].cells.codex?.level, 'hard')
  assert.ok(rows[0].cells.codex?.how.includes('read-only'))
  assert.equal(rows[2].cells.omp?.level, 'degraded')
})

test('capMatrix：点亮的意图 active=true，且 write 的 Claude 附注随 shell 变化', () => {
  const a = capMatrix({ caps: { write: false } })
  assert.ok(a[0].active && !a[1].active)
  assert.ok(a[0].cells.claude?.how.includes('Bash'))
  const b = capMatrix({ caps: { write: false, shell: false } })
  assert.ok(!b[0].cells.claude?.how.includes('Bash'))
})

test('capMatrix：有 mcp / raw 时追加对应行，只在有内容时出现', () => {
  const rows = capMatrix({ caps: { mcp: { denyServers: ['s'] } }, raw: { codex: { disable: ['web_search'] } } }, { knownMcpServers: ['s'] })
  assert.deepEqual(rows.map((r) => r.cap), ['write', 'shell', 'imageGen', 'mcpServers', 'raw'])
  const srv = rows[3]
  assert.ok(srv.active)
  assert.ok(srv.cells.codex?.how.includes('s'))
  const raw = rows[4]
  assert.equal(raw.cells.claude, undefined, 'raw.codex 不该出现在 Claude 格')
  assert.equal(raw.cells.codex?.cap, 'raw')
})

test('degradedLines：只回 degraded / unsupported 的行', () => {
  const bounds = { caps: { write: false as const, imageGen: false as const } }
  assert.deepEqual(degradedLines(bounds, 'claude'), [])
  const codex = degradedLines(bounds, 'codex')
  assert.equal(codex.length, 1)
  assert.equal(codex[0].cap, 'imageGen')
  assert.equal(degradedLines(undefined, 'omp').length, 0)
})
