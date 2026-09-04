// TS Compiler API 那一层。**在临时目录里造真项目**，不 mock ——
// 这一层的全部风险是「符号解析到哪儿去了」，mock 掉就什么都没测。
//
// 头两条钉的是实测踩到的坑（见 docs/代码地图-AST符号级可视化-可行性与设计.html 第三节）：
// 不解 alias → 跨文件调用全变自环；只数 CallExpression → 回调式引用全被判死。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'
import { analyzeSymbols } from './tsSymbols.ts'
import type { SymbolGraphResult, SymbolNode } from '../shared/symbolGraph.ts'

const tmps: string[] = []
after(() => tmps.forEach((d) => fs.rmSync(d, { recursive: true, force: true })))

function proj(files: Record<string, string>, opts: Record<string, unknown> = {}): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sym-'))
  tmps.push(d)
  fs.writeFileSync(
    path.join(d, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'bundler', strict: true, ...opts },
      include: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx']
    })
  )
  for (const [rel, body] of Object.entries(files)) {
    const f = path.join(d, rel)
    fs.mkdirSync(path.dirname(f), { recursive: true })
    fs.writeFileSync(f, body)
  }
  return d
}
const find = (r: SymbolGraphResult, file: string, name: string): SymbolNode | undefined =>
  r.files.find((f) => f.file === file)?.symbols.find((s) => s.name === name)

describe('坑 1 · 跨文件调用不能变成自环', () => {
  it('**import 进来再调用，边要指向定义所在的文件**', () => {
    const d = proj({
      'a.ts': 'export function target(): void {}\n',
      'b.ts': "import { target } from './a'\nexport function caller(): void { target() }\n"
    })
    const r = analyzeSymbols(d)
    // target 在 a.ts 里，被 b.ts 引用了一次
    assert.equal(find(r, 'a.ts', 'target')?.refs, 1, '不解 alias 的话这里会是 0（引用被记到 b.ts 自己头上）')
  })

  it('自环不该出现在文件内结构里', () => {
    const d = proj({
      'a.ts': 'export function t(): void {}\n',
      'b.ts': "import { t } from './a'\nexport function c(): void { t() }\n"
    })
    const r = analyzeSymbols(d)
    const b = r.files.find((f) => f.file === 'b.ts')
    assert.deepEqual(b?.edges, [], 'b.ts 内部没有互相调用，不该有边')
  })
})

describe('坑 2 · 「被使用」不只是「被调用」', () => {
  it('**作为回调传出去也算用了**（setInterval(fn) 这种）', () => {
    const d = proj({
      'a.ts': 'export function tick(): void {}\n',
      'b.ts': "import { tick } from './a'\nsetInterval(tick, 1000)\n"
    })
    assert.equal(find(analyzeSymbols(d), 'a.ts', 'tick')?.refs, 1, '只数 CallExpression 的话这里是 0')
  })

  it('再导出也算用了', () => {
    const d = proj({
      'a.ts': 'export function f(): void {}\n',
      'b.ts': "export { f } from './a'\n"
    })
    assert.ok((find(analyzeSymbols(d), 'a.ts', 'f')?.refs ?? 0) > 0)
  })

  it('真没人用的就是 0', () => {
    const d = proj({ 'a.ts': 'export function lonely(): void {}\n' })
    assert.equal(find(analyzeSymbols(d), 'a.ts', 'lonely')?.refs, 0)
  })
})

describe('文件内结构', () => {
  it('同文件里的调用要连成边', () => {
    const d = proj({ 'a.ts': 'function low(): void {}\nexport function high(): void { low() }\n' })
    const f = analyzeSymbols(d).files.find((x) => x.file === 'a.ts')
    assert.deepEqual(f?.edges.map((e) => e.from + '→' + e.to), ['a.ts#high→a.ts#low'])
  })

  it('列出函数与它们的行号', () => {
    const d = proj({ 'a.ts': '\n\nexport function first(): void {}\n' })
    const s = find(analyzeSymbols(d), 'a.ts', 'first')
    assert.equal(s?.line, 3, '行号是 1-based')
  })

  it('导出与否要分清 —— 内部函数没人用的性质和导出的不同', () => {
    const d = proj({ 'a.ts': 'function inner(): void {}\nexport function outer(): void { inner() }\n' })
    const r = analyzeSymbols(d)
    assert.equal(find(r, 'a.ts', 'inner')?.exported, false)
    assert.equal(find(r, 'a.ts', 'outer')?.exported, true)
  })
})

describe('坑 3 · checkJs:false 的区域要标不可信', () => {
  it('默认（不开 checkJs）时 .js 文件标成不可信', () => {
    const d = proj({ 'a.ts': 'export function x(): void {}\n', 'b.js': 'export function y() {}\n' }, { allowJs: true, checkJs: false })
    const r = analyzeSymbols(d)
    assert.equal(r.files.find((f) => f.file === 'a.ts')?.trustworthy, true)
    assert.equal(r.files.find((f) => f.file === 'b.js')?.trustworthy, false)
    assert.ok(r.untrusted >= 1)
  })

  it('**不可信文件里的零引用进 unsure，不进 dead**', () => {
    const d = proj({ 'b.js': 'export function ghost() {}\n' }, { allowJs: true, checkJs: false })
    const r = analyzeSymbols(d)
    assert.ok(r.dead.every((x) => x.verdict === 'unsure'), JSON.stringify(r.dead))
  })
})

describe('死代码清单', () => {
  it('真死的进 dead', () => {
    const d = proj({ 'a.ts': 'export function used(): void {}\nexport function unused(): void {}\n', 'b.ts': "import { used } from './a'\nused()\n" })
    const r = analyzeSymbols(d)
    assert.deepEqual(r.dead.filter((x) => x.verdict === 'dead').map((x) => x.sym.name), ['unused'])
  })

  it('测试文件里的不进清单', () => {
    const d = proj({ 'a.test.ts': 'export function helper(): void {}\n' })
    assert.deepEqual(analyzeSymbols(proj({ 'a.test.ts': 'export function helper(): void {}\n' })).dead, [])
  })
})

describe('对象字面量里的方法不进死代码清单', () => {
  it('**实现一个接口成员不该被判死** —— 调用方引的是接口，声明处对不上', () => {
    const d = proj({
      'p.ts': 'export interface Proc { write(s: string): void }\n' +
              'export function make(): Proc { return { write(s: string): void { void s } } }\n',
      'u.ts': "import { make } from './p'\nconst p = make()\np.write('x')\n"
    })
    const r = analyzeSymbols(d)
    const names = r.dead.map((x) => x.sym.name)
    assert.ok(!names.includes('write'), '对象字面量方法混进了死代码清单：' + names.join(','))
  })

  it('但它们仍然出现在文件内结构里 —— 那是有用的信息', () => {
    const d = proj({ 'p.ts': 'export function make() { return { helper(): void {} } }\n' })
    const f = analyzeSymbols(d).files.find((x) => x.file === 'p.ts')
    assert.ok(f?.symbols.some((s) => s.name === 'helper'), '结构图里不该少了它')
  })

  it('顶层函数照旧进清单', () => {
    const d = proj({ 'a.ts': 'export function reallyDead(): void {}\n' })
    assert.deepEqual(analyzeSymbols(d).dead.map((x) => x.sym.name), ['reallyDead'])
  })
})

describe('坑 4 · 动态 import', () => {
  it('**`lazy(() => import("./x"))` 里的导出不该被判死**', () => {
    const d = proj({
      'v.ts': 'export function View(): void {}\n',
      'a.ts': "const L = () => import('./v')\nvoid L\n"
    })
    const names = analyzeSymbols(d).dead.map((x) => x.sym.name)
    assert.ok(!names.includes('View'), '动态 import 的导出被判死了：' + names.join(','))
  })

  it('`const { f } = await import("./x")` 同理', () => {
    const d = proj({
      'v.ts': 'export function f(): void {}\n',
      'a.ts': "export async function go(): Promise<void> { const { f } = await import('./v'); f() }\n"
    })
    assert.ok(!analyzeSymbols(d).dead.map((x) => x.sym.name).includes('f'))
  })

  it('**没被动态 import 的照旧判死** —— 别把这条修成「什么都不报」', () => {
    const d = proj({ 'v.ts': 'export function ghost(): void {}\n', 'a.ts': 'export const x = 1\n' })
    assert.ok(analyzeSymbols(d).dead.map((x) => x.sym.name).includes('ghost'))
  })
})
