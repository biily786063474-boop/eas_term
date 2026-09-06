// 内置角色 × 三家 harness 的绑定矩阵快照。
//
// roleBinding.test.ts 只测了「每个 cap 单独 × 三家」，没有一条测试钉住
// BUILTIN_ROLES 里**实际**摆的那些角色——万一 illustrator 手滑把 `caps.imageGen: false`
// 删掉，或者哪个内置角色不小心多带了个 `caps`，编译器和那份测试都不会红。
//
// 这里显式断言每个内置角色在三家上的落点，写死角色 id 而不是从 role.caps 反推期望值：
// 反推等于用 bindRole 验证 bindRole，测的是恒等式。新增/改动某个内置角色的能力位，
// 这份快照必须跟着手改——那正是它存在的意义（不是自动通过，是逼一次人工核对）。
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { bindRole, CLAUDE_WRITE_TOOLS, IMAGE_MCP_PATTERNS, OMP_WRITE_TOOLS } from '../shared/roleBinding.ts'
import type { HarnessId } from '../shared/types'
import { BUILTIN_ROLES } from './builtinRoles.ts'

const KINDS: readonly HarnessId[] = ['claude', 'codex', 'omp']

/** 写保护落点：勘探员 / 验官（caps.write === false） */
const WRITE_PROTECTED = new Set(['scout', 'inspector'])
/** 生图落点：画师（caps.imageGen === false） */
const IMAGE_LIMITED = new Set(['illustrator'])

test('内置角色数组没有静默增减 —— 加/删一个角色要顺手改这份快照', () => {
  assert.deepEqual(
    BUILTIN_ROLES.map((r) => r.id),
    ['e2e', 'scout', 'builder', 'inspector', 'prototyper', 'writer', 'illustrator', 'runner']
  )
})

test('勘探员 / 验官：三家都落到写保护，没有别的报告行', () => {
  for (const id of WRITE_PROTECTED) {
    const role = BUILTIN_ROLES.find((r) => r.id === id)!
    for (const kind of KINDS) {
      const b = bindRole({ caps: role.caps, raw: role.raw }, kind)
      assert.equal(b.report.length, 1, `${id}/${kind} 应只有一条 write 落点`)
      assert.equal(b.report[0].cap, 'write')
      assert.equal(b.report[0].level, 'hard', `${id}/${kind} 写保护是硬限制`)
      if (kind === 'claude') {
        assert.deepEqual(b.claude.deny, [...CLAUDE_WRITE_TOOLS], `${id}/claude`)
      } else if (kind === 'codex') {
        assert.equal(b.codex.sandbox, 'read-only', `${id}/codex`)
        assert.deepEqual(b.codex.disable, [], `${id}/codex 不该额外禁用别的内置工具`)
      } else {
        assert.deepEqual(b.omp.removeTools, [...OMP_WRITE_TOOLS], `${id}/omp`)
      }
    }
  }
})

test('画师：三家都落到生图限制，Codex / omp 是 degraded，Claude 是 hard', () => {
  const role = BUILTIN_ROLES.find((r) => r.id === 'illustrator')!
  const claude = bindRole({ caps: role.caps, raw: role.raw }, 'claude')
  assert.equal(claude.report.length, 1)
  assert.equal(claude.report[0].cap, 'imageGen')
  assert.equal(claude.report[0].level, 'hard')
  assert.deepEqual(claude.claude.deny, IMAGE_MCP_PATTERNS.map((p) => `mcp__${p}`))

  const codex = bindRole({ caps: role.caps, raw: role.raw }, 'codex')
  assert.equal(codex.report.length, 1)
  assert.equal(codex.report[0].level, 'degraded', 'Codex 关不掉内置生图，只能按名关 server')
  assert.deepEqual(codex.codex.disable, ['image_generation'])

  const omp = bindRole({ caps: role.caps, raw: role.raw }, 'omp')
  assert.equal(omp.report.length, 1)
  assert.equal(omp.report[0].level, 'degraded', 'omp 没有内置生图开关，只能按名不连 server')
  assert.deepEqual(omp.omp.dropServerPatterns, [...IMAGE_MCP_PATTERNS])
})

test('其余内置角色（全流程/工匠/原型师/笔杆子/杂役）：三家参数全空，没有护栏也没有报告行', () => {
  const rest = BUILTIN_ROLES.filter((r) => !WRITE_PROTECTED.has(r.id) && !IMAGE_LIMITED.has(r.id))
  assert.deepEqual(
    rest.map((r) => r.id),
    ['e2e', 'builder', 'prototyper', 'writer', 'runner']
  )
  for (const role of rest) {
    for (const kind of KINDS) {
      const b = bindRole({ caps: role.caps, raw: role.raw }, kind)
      assert.deepEqual(b.claude.deny, [], `${role.id}/${kind}`)
      assert.deepEqual(b.codex, { disable: [], disableServers: [], sandbox: undefined }, `${role.id}/${kind}`)
      assert.deepEqual(b.omp, { removeTools: [], dropServers: [], dropServerPatterns: [] }, `${role.id}/${kind}`)
      assert.deepEqual(b.report, [], `${role.id}/${kind}`)
    }
  }
})
