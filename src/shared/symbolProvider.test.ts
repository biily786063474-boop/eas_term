import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { SymbolNode } from './symbolGraph.ts'
import {
  NEIGHBOR_MAX,
  providerFor,
  rankAndTrim,
  refOf,
  type CallSite,
  type ProviderInfo
} from './symbolProvider.ts'

const sym = (id: string, line = 1): SymbolNode => ({
  id, file: 'a.ts', name: id, kind: 'function', line, character: 0, exported: true, refs: 0, topLevel: true
})
const site = (id: string, n: number): CallSite => ({ symbol: sym(id), lines: Array.from({ length: n }, (_, i) => i + 1) })

describe('refOf', () => {
  it('**1-based → 0-based 只在这一处转** —— 转两次就差一行，拿到的是别的符号', () => {
    assert.equal(refOf(sym('x', 10)).line, 9)
  })
  it('第 1 行变成 0，不会变成 -1', () => {
    assert.equal(refOf(sym('x', 1)).line, 0)
  })
  it('列默认 0，可以指定', () => {
    assert.equal(refOf(sym('x'), 7).character, 7)
  })
})

describe('rankAndTrim', () => {
  it('**按调用次数从多到少** —— 调用最多的才是「动了会伤到谁」的答案', () => {
    const r = rankAndTrim([site('a', 1), site('b', 5), site('c', 3)])
    assert.deepEqual(r.sites.map((s) => s.symbol.id), ['b', 'c', 'a'])
  })
  it('没超上限时 truncated 是 false', () => {
    assert.equal(rankAndTrim([site('a', 1)]).truncated, false)
  })
  it('超了要截断并**如实说**', () => {
    const many = Array.from({ length: NEIGHBOR_MAX + 5 }, (_, i) => site('s' + i, i))
    const r = rankAndTrim(many)
    assert.equal(r.sites.length, NEIGHBOR_MAX)
    assert.equal(r.truncated, true)
  })
  it('截断从少的那头砍 —— 留下的是调用次数最多的', () => {
    const many = Array.from({ length: NEIGHBOR_MAX + 3 }, (_, i) => site('s' + i, i))
    const r = rankAndTrim(many)
    assert.ok(r.sites.every((s) => s.lines.length >= 3), '砍错了方向')
  })
  it('次数相同时按 id 稳定排序 —— 同一份数据每次打开顺序要一样', () => {
    const a = rankAndTrim([site('z', 2), site('a', 2)]).sites.map((s) => s.symbol.id)
    const b = rankAndTrim([site('a', 2), site('z', 2)]).sites.map((s) => s.symbol.id)
    assert.deepEqual(a, b)
  })
})

describe('providerFor', () => {
  const ps: ProviderInfo[] = [
    { name: 'TypeScript', extensions: ['.ts', '.tsx'], status: 'ready' },
    { name: 'clangd', extensions: ['.c', '.h', '.cpp'], status: 'ready' },
    { name: 'sourcekit-lsp', extensions: ['.swift'], status: 'missing', detail: '没装' }
  ]
  it('按扩展名挑', () => {
    assert.equal(providerFor('a/b.ts', ps)?.name, 'TypeScript')
    assert.equal(providerFor('a/b.cpp', ps)?.name, 'clangd')
  })
  it('大小写不敏感', () => {
    assert.equal(providerFor('a/B.TS', ps)?.name, 'TypeScript')
  })
  it('没人认就是 null —— **不猜、不回落到某个 provider**', () => {
    assert.equal(providerFor('a/b.rs', ps), null)
  })
  it('**没装的 provider 也要被挑中** —— 这样界面才能说「装了 X 才能画」，而不是沉默', () => {
    assert.equal(providerFor('a/b.swift', ps)?.status, 'missing')
  })
})
