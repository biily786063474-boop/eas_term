import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planRefresh } from './rulesRefresh.ts'

const src = [
  { name: 'SKILL.md', text: 'A' },
  { name: 'generate.md', text: 'B' }
]

test('没装过 → 一个字都不写', () => {
  // 用户卸载过「使用指引」，下次启动自己装回来就是不听话（MCP 那条刚因此改过）
  assert.deepEqual(planRefresh(src, null), [])
})

test('装着且内容一致 → 什么都不做', () => {
  assert.deepEqual(planRefresh(src, { 'SKILL.md': 'A', 'generate.md': 'B' }), [])
})

test('装着但某个文件过期 → 只写那一个', () => {
  assert.deepEqual(planRefresh(src, { 'SKILL.md': 'A', 'generate.md': '旧' }), ['generate.md'])
})

test('装着但缺了新版新增的文件 → 补上', () => {
  // 升级后多出来的模块（比如 generate.md 是拆分渐进式披露时才有的）
  assert.deepEqual(planRefresh(src, { 'SKILL.md': 'A' }), ['generate.md'])
})

test('目录在、里面空了 → 全部补齐（这算装着）', () => {
  assert.deepEqual(planRefresh(src, {}), ['SKILL.md', 'generate.md'])
})

test('盘上有我们不认识的孤儿文件 → 不管它', () => {
  // 清理孤儿是卸载的事，刷新只负责「让该有的是新的」
  assert.deepEqual(planRefresh(src, { 'SKILL.md': 'A', 'generate.md': 'B', 'old.md': 'x' }), [])
})
