import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dshRegion, applyDshPatch, DSH_BEGIN, DSH_END, type DshMcpEntry } from './dshPatch.ts'

const E: DshMcpEntry[] = [
  { serverName: 'eas-term', command: 'node', args: ['/a/b/eas-mcp.mjs'], passEnv: ['EAS_TERM_PORT', 'EAS_TERM_TOKEN'] }
]
// profile 首次初始化后就是这个样子
const FRESH = `# Your patch layer for this dsh profile, applied after every bundle layer:
# a top-level YAML array of loader patch entries (id-targeted config
# overrides, disables, and insert lists; \`!!js\` expressions allowed).
[]
`

test('生成的段落是 dsh-mcp-client 的形状', () => {
  const r = dshRegion(E)
  assert.ok(r.includes("name: '@deepseek-ai/dsh-mcp-client'"))
  assert.ok(r.includes('serverName: "eas-term"'))
  assert.ok(r.includes('transport: stdio'))
  assert.ok(r.startsWith(DSH_BEGIN) && r.endsWith(DSH_END))
})

// token 落进配置文件就等于门禁失效
test('只写环境变量名，绝不写值', () => {
  const r = dshRegion(E)
  assert.ok(r.includes('EAS_TERM_TOKEN: !!js process.env.EAS_TERM_TOKEN'))
  assert.ok(!/EAS_TERM_TOKEN:\s*["']?[0-9a-f]{8}/.test(r), '不许出现真实 token 样式的值')
})

// 同一个文档里既有 flow 空数组又有块序列 → YAML 解析失败
test('初始的 [] 会被去掉，不会和块序列冲突', () => {
  const out = applyDshPatch(FRESH, dshRegion(E))
  assert.ok(!out.split('\n').some((l) => l.trim() === '[]'), `残留了 []：\n${out}`)
  assert.ok(out.includes('- id: mcp-eas-term'))
  assert.ok(out.includes('# Your patch layer'), '用户的注释头要保留')
})

test('重复写入是幂等的，不会越堆越多', () => {
  const once = applyDshPatch(FRESH, dshRegion(E))
  const twice = applyDshPatch(once, dshRegion(E))
  assert.equal(once, twice)
  assert.equal((twice.match(/mcp-eas-term/g) || []).length, 1)
})

// 这是围栏方案存在的全部理由
test('用户自己写的条目原样保留', () => {
  const mine = `- id: my-own-plugin
  name: '@me/whatever'
  config:
    x: 1
`
  const out = applyDshPatch(mine, dshRegion(E))
  assert.ok(out.includes('my-own-plugin'))
  assert.ok(out.includes("name: '@me/whatever'"))
  assert.ok(out.includes('mcp-eas-term'))
})

test('卸载只删我们那段，用户的留着', () => {
  const mine = "- id: my-own-plugin\n  name: '@me/whatever'\n"
  const out = applyDshPatch(applyDshPatch(mine, dshRegion(E)), '')
  assert.ok(out.includes('my-own-plugin'))
  assert.ok(!out.includes('mcp-eas-term'))
  assert.ok(!out.includes(DSH_BEGIN))
})

// 空文件不是合法的 patch 层
test('全部卸载后还回一个空数组', () => {
  const out = applyDshPatch(applyDshPatch(FRESH, dshRegion(E)), '')
  const meaningful = out.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
  assert.deepEqual(meaningful, ['[]'])
})

test('两个 server 各生成一个插件实例', () => {
  const r = dshRegion([...E, { serverName: 'bizone-canvas', command: 'x', args: [], passEnv: [] }])
  assert.equal((r.match(/dsh-mcp-client/g) || []).length, 2)
  assert.ok(r.includes('- id: mcp-bizone-canvas'))
})

test('没有条目时段落为空，applyDshPatch 视同卸载', () => {
  assert.equal(dshRegion([]), '')
})
