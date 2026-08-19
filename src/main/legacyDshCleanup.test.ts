import { test } from 'node:test'
import assert from 'node:assert/strict'
import { stripDshRegion, DSH_BEGIN, DSH_END } from './legacyDshCleanup.ts'

const region = `${DSH_BEGIN}\n- id: mcp-eas-term\n  name: '@deepseek-ai/dsh-mcp-client'\n${DSH_END}`

test('摘掉围栏段，用户自己的条目一个字不动', () => {
  const raw = `# 我的注释\n- id: my-plugin\n  name: 'whatever'\n\n${region}\n`
  const out = stripDshRegion(raw)
  assert.ok(!out.includes(DSH_BEGIN))
  assert.ok(out.includes('# 我的注释'))
  assert.ok(out.includes("- id: my-plugin"))
})

test('只剩我们那一段时，还回一个合法的空数组（空文件不是合法 patch 层）', () => {
  assert.equal(stripDshRegion(`${region}\n`), '[]\n')
})

test('原文件是 `[]` 加我们那段 → 结果仍是 `[]`，不留两个', () => {
  const out = stripDshRegion(`[]\n\n${region}\n`)
  assert.equal(out.split('\n').filter((l) => l.trim() === '[]').length, 1)
})

test('没装过（文件里没有围栏）→ 内容原样', () => {
  const raw = '- id: someone-elses\n  name: x\n'
  assert.equal(stripDshRegion(raw), raw)
})
