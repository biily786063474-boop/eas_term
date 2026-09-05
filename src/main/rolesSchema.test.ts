import assert from 'node:assert/strict'
import { test } from 'node:test'

import { IMAGE_MCP_PATTERNS } from '../shared/roleBinding.ts'
import { migrateToolsV1, sanitizeRoles, ROLES_FILE_VERSION } from './rolesSchema.ts'

test('版本号是 2', () => assert.equal(ROLES_FILE_VERSION, 2))

test('v1 deny ⊇ {Write,Edit} → caps.write=false，NotebookEdit 一并吃掉', () => {
  const m = migrateToolsV1({ deny: ['Write', 'Edit', 'NotebookEdit'] })
  assert.deepEqual(m.caps, { write: false })
  assert.equal(m.raw, undefined)
})

test('只 deny 了 Write 没 Edit → 不算写保护，进 raw.claude.deny', () => {
  const m = migrateToolsV1({ deny: ['Write'] })
  assert.equal(m.caps, undefined)
  assert.deepEqual(m.raw, { claude: { deny: ['Write'] } })
})

test('deny Bash → caps.shell=false', () => {
  assert.deepEqual(migrateToolsV1({ deny: ['Bash'] }).caps, { shell: false })
})

test('roles.ts 那组生图通配（带 mcp__ 前缀）→ caps.imageGen=false', () => {
  const m = migrateToolsV1({ deny: IMAGE_MCP_PATTERNS.map((p) => `mcp__${p}`) })
  assert.deepEqual(m.caps, { imageGen: false })
})

test('其他 mcp__ 项去前缀进 caps.mcp.denyTools；denyServers 原样搬', () => {
  const m = migrateToolsV1({ deny: ['mcp__*canvas*'], denyServers: ['x'] })
  assert.deepEqual(m.caps, { mcp: { denyServers: ['x'], denyTools: ['*canvas*'] } })
})

test('认不出的 deny 项进 raw.claude.deny，allow 丢弃并回报', () => {
  const m = migrateToolsV1({ deny: ['WebFetch'], allow: ['Read'] })
  assert.deepEqual(m.raw, { claude: { deny: ['WebFetch'] } })
  assert.deepEqual(m.droppedAllow, ['Read'])
})

test('sanitizeRoles：v1 记录（有 tools 无 caps）自动迁移；v2 记录原样收；坏条目丢掉不拖垮整份', () => {
  const out = sanitizeRoles({
    roles: [
      { id: 'a', name: 'A', tools: { deny: ['Write', 'Edit'] } },
      { id: 'b', name: 'B', caps: { shell: false, mcp: { denyServers: ['s'] } }, raw: { codex: { disable: ['web_search'] } } },
      { id: '', name: '没 id' },
      null,
      { id: 'a', name: '重复 id' }
    ]
  })
  assert.deepEqual(out.map((r) => r.id), ['a', 'b'])
  assert.deepEqual(out[0].caps, { write: false })
  // `AgentRole` 已经不再有 `tools` 字段（Task 11 删掉了），这里转成 unknown 记录来读，
  // 断言的仍是运行时输出——sanitizeRoles 组装 out 时没有任何一处会带上这个键。
  assert.equal((out[0] as unknown as Record<string, unknown>).tools, undefined, '迁移后不该再带 tools')
  assert.deepEqual(out[1].caps, { shell: false, mcp: { denyServers: ['s'] } })
  assert.deepEqual(out[1].raw, { codex: { disable: ['web_search'] } })
})

test('sanitizeRoles：raw 逃生口丢弃 - 开头的条目——bindRole 原样把它拼进 CLI 参数，"--foo" 会变成一个意外的 flag，不是一个要 deny 的名字', () => {
  const [r] = sanitizeRoles({
    roles: [{ id: 'a', name: 'A', raw: { claude: { deny: ['Bash', '--foo'] }, omp: { removeTools: ['--danger'] } } }]
  })
  assert.deepEqual(r.raw, { claude: { deny: ['Bash'] } }, 'omp.removeTools 过滤完是空的，整条当没给，不是留一个空数组')
})

test('sanitizeRoles：caps 里只认 false，true / 字符串一律当没写', () => {
  const [r] = sanitizeRoles({ roles: [{ id: 'a', name: 'A', caps: { write: true, shell: 'no', imageGen: false } }] })
  assert.deepEqual(r.caps, { imageGen: false })
})

test('sanitizeRoles：model/effort 收三个键（含 omp）', () => {
  const [r] = sanitizeRoles({ roles: [{ id: 'a', name: 'A', model: { claude: 'opus', omp: 'anthropic/x', bogus: 'y' }, effort: { codex: 'high' } }] })
  assert.deepEqual(r.model, { claude: 'opus', omp: 'anthropic/x' })
  assert.deepEqual(r.effort, { codex: 'high' })
})

test('sanitizeRoles：不是数组 → 空', () => {
  assert.deepEqual(sanitizeRoles({ roles: 'x' }), [])
  assert.deepEqual(sanitizeRoles(null), [])
})
