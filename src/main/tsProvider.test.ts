// TS 的邻域 provider。在临时目录里造真项目，不 mock。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'
import { dropTsCache, tsNeighborhood } from './tsProvider.ts'

const tmps: string[] = []
after(() => tmps.forEach((d) => fs.rmSync(d, { recursive: true, force: true })))
function proj(files: Record<string, string>): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'tsp-'))
  tmps.push(d)
  fs.writeFileSync(path.join(d, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'bundler', strict: true },
    include: ['**/*.ts', '**/*.tsx']
  }))
  for (const [rel, body] of Object.entries(files)) {
    const f = path.join(d, rel)
    fs.mkdirSync(path.dirname(f), { recursive: true })
    fs.writeFileSync(f, body)
  }
  return d
}

describe('谁调用了这个（incoming）', () => {
  it('跨文件的调用方要找得到', () => {
    const d = proj({
      'a.ts': 'export function target(): void {}\n',
      'b.ts': "import { target } from './a'\nexport function caller(): void { target() }\n"
    })
    const n = tsNeighborhood(d, { file: 'a.ts', line: 0, character: 16, name: 'target' })
    assert.deepEqual(n?.incoming.map((c) => c.symbol.name), ['caller'])
  })

  it('**同一个调用方调多次算一条边、记多行**', () => {
    const d = proj({
      'a.ts': 'export function t(): void {}\n',
      'b.ts': "import { t } from './a'\nexport function c(): void {\n  t()\n  t()\n}\n"
    })
    const n = tsNeighborhood(d, { file: 'a.ts', line: 0, character: 16, name: 't' })
    assert.equal(n?.incoming.length, 1)
    assert.equal(n?.incoming[0].lines.length, 2, '两次调用应记两行：' + JSON.stringify(n?.incoming[0].lines))
  })

  it('文件内的调用也算', () => {
    const d = proj({ 'a.ts': 'function low(): void {}\nexport function high(): void { low() }\n' })
    const n = tsNeighborhood(d, { file: 'a.ts', line: 0, character: 9, name: 'low' })
    assert.deepEqual(n?.incoming.map((c) => c.symbol.name), ['high'])
  })

  it('没人调用时是空数组，不是 null', () => {
    const d = proj({ 'a.ts': 'export function lonely(): void {}\n' })
    const n = tsNeighborhood(d, { file: 'a.ts', line: 0, character: 16, name: 'lonely' })
    assert.deepEqual(n?.incoming, [])
  })
})

describe('这个调用了谁（outgoing）', () => {
  it('列出本仓库里的被调方', () => {
    const d = proj({
      'a.ts': 'export function x(): void {}\nexport function y(): void {}\n',
      'b.ts': "import { x, y } from './a'\nexport function go(): void { x(); y() }\n"
    })
    const n = tsNeighborhood(d, { file: 'b.ts', line: 1, character: 16, name: 'go' })
    assert.deepEqual(n?.outgoing.map((c) => c.symbol.name).sort(), ['x', 'y'])
  })

  it('**node_modules / lib 的不进去** —— 否则满屏 console / setTimeout', () => {
    const d = proj({ 'a.ts': 'export function go(): void { console.log(1); setTimeout(() => {}, 1) }\n' })
    const n = tsNeighborhood(d, { file: 'a.ts', line: 0, character: 16, name: 'go' })
    assert.deepEqual(n?.outgoing, [])
  })
})

describe('定位', () => {
  it('**行列要落在名字上** —— 落在 function 关键字上会拿不到（LSP 的同一条约束）', () => {
    const d = proj({ 'a.ts': 'export function named(): void {}\n' })
    const ok = tsNeighborhood(d, { file: 'a.ts', line: 0, character: 16, name: 'named' })
    assert.ok(ok, '落在名字起始列应该拿得到')
    assert.equal(ok?.center.name, 'named')
  })

  it('找不到符号时返回 null，不抛', () => {
    const d = proj({ 'a.ts': 'export function a(): void {}\n' })
    assert.equal(tsNeighborhood(d, { file: 'nope.ts', line: 0, character: 0, name: 'z' }), null)
  })
})

describe('缓存', () => {
  it('**第二次查同一个项目要快得多** —— 每次重建 Program 的话交互不可用', () => {
    const d = proj({ 'a.ts': 'export function t(): void {}\nexport function c(): void { t() }\n' })
    const ref = { file: 'a.ts', line: 0, character: 16, name: 't' }
    dropTsCache(d)
    const t1 = Date.now(); tsNeighborhood(d, ref); const cold = Date.now() - t1
    const t2 = Date.now(); tsNeighborhood(d, ref); const warm = Date.now() - t2
    assert.ok(warm * 3 < cold + 5, `冷 ${cold}ms / 热 ${warm}ms —— 缓存没生效`)
  })

  it('dropTsCache 之后要重建', () => {
    const d = proj({ 'a.ts': 'export function t(): void {}\n' })
    const ref = { file: 'a.ts', line: 0, character: 16, name: 't' }
    tsNeighborhood(d, ref)
    dropTsCache(d)
    assert.ok(tsNeighborhood(d, ref), '清了缓存还得能查')
  })
})

describe('outgoing 只能是函数，不能混进别的', () => {
  it('**形参不算「调用了谁」** —— 它们的 parent 正好是那个函数，兜底逻辑会误判', () => {
    const d = proj({ 'a.ts': 'export function go(cfg: string, deny: string[]): void { void cfg; void deny }\n' })
    const n = tsNeighborhood(d, { file: 'a.ts', line: 0, character: 16, name: 'go' })
    assert.deepEqual(n?.outgoing.map((c) => c.symbol.name), [], '形参混进来了：' + JSON.stringify(n?.outgoing.map(c=>c.symbol.name)))
  })

  it('**自己不算调用自己**（除非真的递归）', () => {
    const d = proj({ 'a.ts': 'export function solo(x: number): number { return x }\n' })
    const n = tsNeighborhood(d, { file: 'a.ts', line: 0, character: 16, name: 'solo' })
    assert.ok(!n?.outgoing.some((c) => c.symbol.name === 'solo'), '把自己算进去了')
  })

  it('局部变量也不算', () => {
    const d = proj({ 'a.ts': 'export function go(): void { const tmp = 1; void tmp }\n' })
    assert.deepEqual(tsNeighborhood(d, { file: 'a.ts', line: 0, character: 16, name: 'go' })?.outgoing, [])
  })

  it('真的调用别的函数时要有', () => {
    const d = proj({ 'a.ts': 'function dep(): void {}\nexport function go(): void { dep() }\n' })
    const n = tsNeighborhood(d, { file: 'a.ts', line: 1, character: 16, name: 'go' })
    assert.deepEqual(n?.outgoing.map((c) => c.symbol.name), ['dep'])
  })

  it('递归要保留 —— 那是真的自己调自己', () => {
    const d = proj({ 'a.ts': 'export function rec(n: number): number { return n > 0 ? rec(n - 1) : 0 }\n' })
    const n = tsNeighborhood(d, { file: 'a.ts', line: 0, character: 16, name: 'rec' })
    assert.deepEqual(n?.outgoing.map((c) => c.symbol.name), ['rec'])
  })
})

describe('调用方在匿名回调里时的标注', () => {
  it('**不该都叫「（模块顶层）」** —— 那会让测试文件里的一堆调用全糊成一条', () => {
    const d = proj({
      'a.ts': 'export function t(): void {}\n',
      'b.ts': "import { t } from './a'\ndeclare function it(n: string, f: () => void): void\nit('x', () => { t() })\nit('y', () => { t() })\n"
    })
    const n = tsNeighborhood(d, { file: 'a.ts', line: 0, character: 16, name: 't' })
    const names = n?.incoming.map((c) => c.symbol.name) ?? []
    assert.ok(!names.includes('（模块顶层）'), '回调里的调用被标成了模块顶层：' + names.join(','))
  })
})

describe('定位要落在名字上（真机撞到的坑）', () => {
  it('**缩进过的符号也要查得到** —— 列传 0 的话落在空白上，全都报「找不到符号」', () => {
    const d = proj({
      'a.ts': 'export class K {\n  method(): void {}\n}\nexport function use(k: K): void { k.method() }\n'
    })
    // 第 2 行（0-based 1），名字 `method` 在第 2 列
    const n = tsNeighborhood(d, { file: 'a.ts', line: 1, character: 2, name: 'method' })
    assert.ok(n, '缩进 2 格的方法应该查得到')
    assert.equal(n?.center.name, 'method')
  })

  it('列落在空白上就查不到 —— 这条是反过来钉「为什么必须记列」', () => {
    const d = proj({ 'a.ts': 'export class K {\n  method(): void {}\n}\n' })
    assert.equal(tsNeighborhood(d, { file: 'a.ts', line: 1, character: 0, name: 'method' }), null)
  })
})
