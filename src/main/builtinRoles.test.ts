// 内置角色 × 三家 harness 的绑定矩阵快照。
//
// roleBinding.test.ts 只测了「每个 cap 单独 × 三家」，没有一条测试钉住
// BUILTIN_ROLES 里**实际**摆的那些角色——万一 scout 手滑把 `caps.write: false`
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
/** 生图落点：**没有**。2026-09-06 用户决定画师不再默认勾 imageGen（保留 Codex 原生 imagegen），
 *  红线只靠契约文字；这个 Set 留空是刻意的 —— 有人把它填回去要先问用户 */
const IMAGE_LIMITED = new Set<string>([])

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

test('画师：**不带任何 caps**（2026-09-06 用户决定保留 Codex 原生 imagegen），三家参数全空，只有契约', () => {
  const role = BUILTIN_ROLES.find((r) => r.id === 'illustrator')!
  assert.equal(role.caps, undefined, '画师不该再默认勾 imageGen —— 要改先问用户')
  assert.ok(role.contract.includes('生图只允许走用户指定的生成路径'), '红线现在只靠这句契约兜着，不能丢')
  for (const kind of KINDS) {
    const b = bindRole({ caps: role.caps, raw: role.raw }, kind, { codexHome: '/Users/x/.codex' })
    assert.deepEqual(b.claude.deny, [], kind)
    assert.deepEqual(b.codex, { disable: [], disableServers: [], disabledTools: {}, skillsOff: [], sandbox: undefined }, kind)
    assert.deepEqual(b.omp, { removeTools: [], dropServers: [], dropServerPatterns: [] }, kind)
    assert.deepEqual(b.report, [], kind)
  }
})

test('imageGen 开关本身仍可用于自建角色：Claude 通配 deny 是 hard，Codex 给了 codexHome 就摘系统 skill', () => {
  const bounds = { caps: { imageGen: false as const } }
  assert.deepEqual(bindRole(bounds, 'claude').claude.deny, IMAGE_MCP_PATTERNS.map((p) => `mcp__${p}`))
  const codex = bindRole(bounds, 'codex', { codexHome: '/Users/x/.codex' })
  assert.equal(codex.report[0].level, 'hard')
  assert.deepEqual(codex.codex.skillsOff, ['/Users/x/.codex/skills/.system/imagegen/SKILL.md'])
})

test('其余内置角色（全流程/工匠/原型师/笔杆子/画师/杂役）：三家参数全空，没有护栏也没有报告行', () => {
  const rest = BUILTIN_ROLES.filter((r) => !WRITE_PROTECTED.has(r.id) && !IMAGE_LIMITED.has(r.id))
  assert.deepEqual(
    rest.map((r) => r.id),
    ['e2e', 'builder', 'prototyper', 'writer', 'illustrator', 'runner']
  )
  for (const role of rest) {
    for (const kind of KINDS) {
      const b = bindRole({ caps: role.caps, raw: role.raw }, kind)
      assert.deepEqual(b.claude.deny, [], `${role.id}/${kind}`)
      assert.deepEqual(b.codex, { disable: [], disableServers: [], disabledTools: {}, skillsOff: [], sandbox: undefined }, `${role.id}/${kind}`)
      assert.deepEqual(b.omp, { removeTools: [], dropServers: [], dropServerPatterns: [] }, `${role.id}/${kind}`)
      assert.deepEqual(b.report, [], `${role.id}/${kind}`)
    }
  }
})
