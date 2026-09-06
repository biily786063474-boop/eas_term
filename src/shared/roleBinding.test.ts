import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  bindRole,
  codexDisableServerArg,
  codexDisabledToolsArg,
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

// Minor #9：server 名含 . 或 " 时，TOML 点路径必须给这一段加引号——裸写的话 . 会被解析
// 成多一层嵌套、" 直接破坏语法。codexDisableServerArg 与 codexDisabledToolsArg 共用同一个
// 转义辅助，这里各测一次。
test('codexDisableServerArg / codexDisabledToolsArg：server 名含 . 或 " 时 TOML 键要加引号', () => {
  assert.equal(codexDisableServerArg('a.b'), 'mcp_servers."a.b".enabled=false')
  assert.equal(codexDisabledToolsArg('a.b', ['x']), 'mcp_servers."a.b".disabled_tools=["x"]')
  assert.equal(codexDisableServerArg('a"b'), 'mcp_servers."a\\"b".enabled=false', '" 要转义成 \\"')
  assert.equal(codexDisableServerArg('bizone-canvas'), 'mcp_servers.bizone-canvas.enabled=false', '纯 [A-Za-z0-9_-] 仍然裸写，不加引号')
})

test('空卡 = 什么都不加，三家都没有报告行', () => {
  for (const k of ['claude', 'codex', 'omp'] as const) {
    const b = bindRole(undefined, k)
    assert.deepEqual(b.claude.deny, [])
    assert.deepEqual(b.codex, { disable: [], disableServers: [], disabledTools: {}, skillsOff: [], sandbox: undefined })
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

// 阶段三第三项：ctx.claudeWriteGuard 声明「这条路径会附 PreToolUse 写守卫」时，
// write:false 在 Claude 上的 how 要改成两道闸的说明，档位仍是 hard。
test('write:false + claudeWriteGuard:true —— Claude 的 how 变成两道闸的说明，档位仍是 hard', () => {
  const bounds = { caps: { write: false as const } }
  const b = bindRole(bounds, 'claude', { claudeWriteGuard: true })
  const line = b.report.find((l) => l.cap === 'write')!
  assert.equal(line.level, 'hard')
  assert.ok(line.how.includes('--disallowedTools Write Edit NotebookEdit'), '第一道闸不能丢')
  assert.ok(line.how.includes('PreToolUse 守卫'), '缺第二道闸的说明')
  assert.ok(line.how.includes('脚本文件里的写操作拦不住'), '漏网要如实说，不能让人以为守卫是万能的')
})

// claudeWriteGuard:true 但 shell 也整个禁掉时，守卫是死重量（Bash 已经被
// --disallowedTools Bash 挡死），how 不该说「附了」误导人——这是 bindRole 自己
// 的自洽检查，不依赖调用方传值精确（真实的 session.ts 也不会在这个组合下生成
// writeGuardSettings，这里只是让纯函数自己也守住同一条判据）。
test('write:false + shell:false + claudeWriteGuard:true —— shell 已禁时守卫是死重量，how 退回不提 Bash 的版本', () => {
  const b = bindRole({ caps: { write: false, shell: false } }, 'claude', { claudeWriteGuard: true })
  const line = b.report.find((l) => l.cap === 'write')!
  assert.ok(!line.how.includes('PreToolUse 守卫'), 'shell 已禁时守卫没有意义，不该在 how 里声称附了')
  assert.equal(line.how, `--disallowedTools ${CLAUDE_WRITE_TOOLS.join(' ')}`)
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

// 阶段三第二项：探针确认 `-c mcp_servers.<名>.disabled_tools=[…]` 真把指定工具从模型面前
// 摘掉（判据是延迟工具搜索结果，不是问模型）。denyTools 里形如 `<server>__<tool>`
// （无 `*`、正好一个 `__`、两段都非空）的条目现在能精确摘工具，不必再牺牲整个 server；
// 其余形状（含 `*`、或不是这个形状）维持原样：通配降级为按 server 名整个关。
test('mcp.denyTools 精确写法（<server>__<tool>）在 Codex 上升级为 hard 的 disabled_tools；通配条目仍降级；Claude 侧不变', () => {
  const bounds = {
    caps: { mcp: { denyTools: ['bizone-canvas__generate', 'bizone-canvas__upscale', '*image*'] } }
  }
  const x = bindRole(bounds, 'codex', { knownMcpServers: ['bizone-canvas'] })
  assert.deepEqual(x.codex.disabledTools, { 'bizone-canvas': ['generate', 'upscale'] })
  // 精确条目不该顺带把整个 server 也塞进 disableServers —— 那是通配条目才走的降级路径
  assert.deepEqual(x.codex.disableServers, [])
  const mcpToolsLines = x.report.filter((l) => l.cap === 'mcpTools')
  assert.equal(mcpToolsLines.length, 2, '两类都有内容时报告两行')
  const hard = mcpToolsLines.find((l) => l.level === 'hard')
  const degraded = mcpToolsLines.find((l) => l.level === 'degraded')
  assert.ok(hard, '精确条目要有一条 hard 报告行')
  assert.ok(hard!.how.includes('disabled_tools'))
  assert.ok(hard!.how.includes('mcp__bizone-canvas.generate') || hard!.how.includes('mcp__<server>.<tool>'), 'how 里要点出 Codex 的命名差异')
  assert.ok(degraded, '通配条目仍要降级')
  assert.ok(degraded!.how.includes('*image*') || degraded!.how.includes('无匹配'), 'degraded 那行仍是旧口径')

  // Claude 侧对同一份输入仍是逐字通配 deny，不受这次改动影响
  const c = bindRole(bounds, 'claude')
  assert.deepEqual(c.claude.deny, ['mcp__bizone-canvas__generate', 'mcp__bizone-canvas__upscale', 'mcp__*image*'])
})

test('mcp.denyTools 精确写法 —— 只有精确条目、没有通配时只报一行 hard，disabledTools 已排序去重', () => {
  const bounds = { caps: { mcp: { denyTools: ['a__z', 'a__y', 'a__z'] } } }
  const x = bindRole(bounds, 'codex', { knownMcpServers: ['a'] })
  assert.deepEqual(x.codex.disabledTools, { a: ['y', 'z'] }, '去重且排序')
  assert.equal(x.report.filter((l) => l.cap === 'mcpTools').length, 1)
  assert.equal(x.report.find((l) => l.cap === 'mcpTools')!.level, 'hard')
})

// 2026-09-06 评审修复 Important #2：精确条目全被 knownMcpServers 过滤掉时，
// 退回通配路径（见下面 Important #3 的测试），不再单独报一行 hard——没有精确条目
// 留下就不该有 hard 行，此时应该只剩通配降级的那一行。
test('mcp.denyTools 精确写法 —— server 不在 knownMcpServers 清单时退回通配路径（Codex 对不存在的 server 名会拒绝启动），不生成 hard 行', () => {
  const bounds = { caps: { mcp: { denyTools: ['ghost__foo'] } } }
  const x = bindRole(bounds, 'codex', { knownMcpServers: ['bizone-canvas'] })
  assert.deepEqual(x.codex.disabledTools, {})
  const mcpToolsLines = x.report.filter((l) => l.cap === 'mcpTools')
  assert.equal(mcpToolsLines.length, 1, '退回通配路径后仍只应有一行报告')
  assert.equal(mcpToolsLines[0].level, 'degraded', '没有精确条目留下就不该报 hard')
  assert.ok(mcpToolsLines[0].how.includes('无匹配'), '字面匹配不上任何已知 server')
})

// 2026-09-06 评审修复 Important #3：server 名自带 __（比如真实 server 就叫 a__b）时，
// parsePreciseTool 会把它误判成 <server>__<tool> 精确形状（server=a, tool=b）；这个
// server 不在清单里就退回原始字符串 'a__b' 走通配路径，字面匹配照旧能命中真正叫
// a__b 的 server——不会「既不整关也不报告」。
test('mcp.denyTools 精确写法 —— server 名字面自带 __ 时不会被拆错，退回通配路径后字面匹配照旧命中同名 server', () => {
  const bounds = { caps: { mcp: { denyTools: ['a__b'] } } }
  const x = bindRole(bounds, 'codex', { knownMcpServers: ['a__b'] })
  assert.deepEqual(x.codex.disabledTools, {}, '不该被错误拆成 server=a tool=b 精确摘工具')
  assert.deepEqual(x.codex.disableServers, ['a__b'])
  const line = x.report.find((l) => l.cap === 'mcpTools')
  assert.ok(line)
  assert.equal(line!.level, 'degraded')
})

// Minor #7：工具名含 __（不是 <server>__<tool> 这个形状，是三段）不算精确，同样退回通配路径。
test('mcp.denyTools —— 形状不是 <server>__<tool>（比如带两个 __）不算精确，退回通配路径', () => {
  const bounds = { caps: { mcp: { denyTools: ['mini__foo__bar'] } } }
  const x = bindRole(bounds, 'codex', { knownMcpServers: ['mini__foo__bar'] })
  assert.deepEqual(x.codex.disabledTools, {})
  assert.deepEqual(x.codex.disableServers, ['mini__foo__bar'], '字面匹配整串，命中同名 server')
})

// Minor #8：同一个 server 已经被 mcp.denyServers 整个关掉时，精确工具条目是死重量，
// 跳过——不该在报告里出现「这家 server 一边整关一边又被精确摘工具」的自相矛盾两行。
test('mcp.denyTools 精确写法 —— 同一个 server 已经在 mcp.denyServers 里整关时，跳过对它的精确工具条目', () => {
  const bounds = { caps: { mcp: { denyServers: ['bizone-canvas'], denyTools: ['bizone-canvas__generate'] } } }
  const x = bindRole(bounds, 'codex', { knownMcpServers: ['bizone-canvas'] })
  assert.deepEqual(x.codex.disableServers, ['bizone-canvas'])
  assert.deepEqual(x.codex.disabledTools, {}, 'server 已整关，精确工具条目应被跳过')
  assert.equal(x.report.filter((l) => l.cap === 'mcpTools').length, 0, '被跳过时不该再多出一行 mcpTools 报告')
})

// Minor #10：disabledTools 有多个 server 时按名字排序遍历，与「排序去重」的描述一致，
// 也让 -c 拼接顺序和 how 摘要顺序不随 JS 对象键插入顺序漂移。
test('mcp.denyTools 精确写法 —— 多个 server 时按名字排序遍历', () => {
  const bounds = { caps: { mcp: { denyTools: ['zserver__t1', 'aserver__t2'] } } }
  const x = bindRole(bounds, 'codex', { knownMcpServers: ['zserver', 'aserver'] })
  const line = x.report.find((l) => l.cap === 'mcpTools')!
  const posA = line.how.indexOf('aserver')
  const posZ = line.how.indexOf('zserver')
  assert.ok(posA >= 0 && posZ >= 0 && posA < posZ, 'aserver 应排在 zserver 前面')
})

// Important #4：hard 那行 how 末尾要点名这条 -c 是整键覆盖，不是追加（同 imageGen 摘 skill
// 那条 -c 的性质一样，用户容易以为是在已有的 disabled_tools 上追加）。
test('mcp.denyTools 精确写法 —— hard 那行 how 末尾提醒这条 -c 整键覆盖 config.toml 里同 server 的 disabled_tools', () => {
  const bounds = { caps: { mcp: { denyTools: ['bizone-canvas__generate'] } } }
  const x = bindRole(bounds, 'codex', { knownMcpServers: ['bizone-canvas'] })
  const line = x.report.find((l) => l.cap === 'mcpTools')!
  assert.ok(line.how.includes('整键覆盖'), 'how 要提醒这是整键覆盖不是追加')
  assert.ok(line.how.includes('disabled_tools'))
})

test('mcp.denyTools 精确写法 —— 没给 knownMcpServers 清单时直通不过滤（与 denyServers 同规矩）', () => {
  const bounds = { caps: { mcp: { denyTools: ['ghost__foo'] } } }
  const x = bindRole(bounds, 'codex')
  assert.deepEqual(x.codex.disabledTools, { ghost: ['foo'] })
})

test('codexDisabledToolsArg：字面量收口成一处，转义规则同 codexSkillsConfigArg，空数组返回空串', () => {
  assert.equal(
    codexDisabledToolsArg('bizone-canvas', ['generate', 'upscale']),
    'mcp_servers.bizone-canvas.disabled_tools=["generate","upscale"]'
  )
  assert.equal(
    codexDisabledToolsArg('s', ['a"b\\c']),
    'mcp_servers.s.disabled_tools=["a\\"b\\\\c"]'
  )
  assert.equal(codexDisabledToolsArg('s', []), '', '空数组返回空串，调用方靠这个决定要不要拼这个 -c')
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

// 2026-09-06 评审修复 Important #1（控制者裁定）：同一 cap 在 bindRole().report 里两行
// （Codex 的 mcp.denyTools 精确+通配混合）时，capMatrix 一格只画一条——不改
// MatrixRow.cells 的结构，合并成一条：level 取最弱，how 用「；」拼接，别把第二行吞掉。
test('capMatrix：同一 cap 两行（Codex 的 denyTools 精确+通配混合）合并成一条，level 取最弱，how 含两段', () => {
  const bounds = { caps: { mcp: { denyTools: ['bizone-canvas__generate', '*image*'] } } }
  const rows = capMatrix(bounds, { knownMcpServers: ['bizone-canvas'] })
  const row = rows.find((r) => r.cap === 'mcpTools')!
  const cell = row.cells.codex!
  assert.equal(cell.level, 'degraded', '两行合并要取最弱档位（degraded 比 hard 弱）')
  assert.ok(cell.how.includes('disabled_tools'), 'how 里要看到精确条目那段')
  assert.ok(cell.how.includes('通配'), 'how 里要看到通配条目那段')
  assert.ok(cell.how.includes('；'), 'how 用；把两段拼起来')
})

test('degradedLines：只回 degraded / unsupported 的行', () => {
  const bounds = { caps: { write: false as const, imageGen: false as const } }
  assert.deepEqual(degradedLines(bounds, 'claude'), [])
  const codex = degradedLines(bounds, 'codex')
  assert.equal(codex.length, 1)
  assert.equal(codex[0].cap, 'imageGen')
  assert.equal(degradedLines(undefined, 'omp').length, 0)
})
