// 入口探测的测试。**在临时目录里造真实文件**，不 mock fs ——
// 这一层的全部风险就在「文件到底在不在、路径拼得对不对」，mock 掉就什么也没测到。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'
import {
  describeNonJs,
  entriesFromDirs,
  entriesFromHtml,
  findEntries
} from './codeGraphAnalyze.ts'

const tmps: string[] = []
function proj(files: Record<string, string>): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-'))
  tmps.push(d)
  for (const [rel, body] of Object.entries(files)) {
    const f = path.join(d, rel)
    fs.mkdirSync(path.dirname(f), { recursive: true })
    fs.writeFileSync(f, body)
  }
  return d
}
after(() => tmps.forEach((d) => fs.rmSync(d, { recursive: true, force: true })))

describe('入口探测', () => {
  it('本仓库那种 electron-vite 布局：四个入口都认出来', () => {
    const d = proj({
      'src/main/index.ts': '',
      'src/preload/index.ts': '',
      'src/renderer/src/main.tsx': '',
      'src/renderer/island/main.tsx': ''
    })
    assert.equal(findEntries(d).length, 4)
  })

  it('**.jsx / .js 也算入口** —— 只认 .tsx 会漏掉一整类项目', () => {
    assert.deepEqual(findEntries(proj({ 'src/main.jsx': '' })), ['src/main.jsx'])
    assert.deepEqual(findEntries(proj({ 'src/index.js': '' })), ['src/index.js'])
  })

  it('electron/main.js 这种「主进程在 electron/ 下」的布局', () => {
    const d = proj({ 'electron/main.js': '', 'src/main.jsx': '' })
    const e = findEntries(d)
    assert.ok(e.includes('electron/main.js'), '主进程入口漏了：' + e.join(','))
    assert.ok(e.includes('src/main.jsx'), '渲染入口漏了：' + e.join(','))
  })

  it('认不出就返回空 —— **不许退回按目录扫**（那会给出一张缺了大半却看着正常的图）', () => {
    assert.deepEqual(findEntries(proj({ 'README.md': '' })), [])
  })

  it('不把目录当成文件', () => {
    const d = proj({ 'src/index.ts/keep.txt': '' }) // src/index.ts 是个目录
    assert.deepEqual(findEntries(d), [])
  })
})

describe('从 index.html 里挖入口', () => {
  it('挖出 <script src> 指的那个模块（taptv 就是这个形状）', () => {
    const d = proj({
      'index.html': '<html><body><script type="module" src="/src/main.jsx"></script></body></html>',
      'src/main.jsx': ''
    })
    assert.deepEqual(entriesFromHtml(d), ['src/main.jsx'])
  })

  it('相对写法 ./src/x.js 也认', () => {
    const d = proj({ 'index.html': '<script src="./src/x.js"></script>', 'src/x.js': '' })
    assert.deepEqual(entriesFromHtml(d), ['src/x.js'])
  })

  it('**只认本地存在的文件** —— CDN 和写错的路径都不要', () => {
    const d = proj({
      'index.html':
        '<script src="https://cdn.example.com/x.js"></script><script src="/src/nope.js"></script>'
    })
    assert.deepEqual(entriesFromHtml(d), [])
  })

  it('没有 index.html 不炸', () => {
    assert.deepEqual(entriesFromHtml(proj({ 'a.txt': '' })), [])
  })
})

describe('目录兜底', () => {
  it('把装着源码的顶层目录当入口', () => {
    const d = proj({ 'lib/a.js': '', 'lib/b.js': '', 'docs/x.md': '' })
    assert.deepEqual(entriesFromDirs(d), ['lib'])
  })

  it('跳过 node_modules / dist / build 这类**不是源码**的目录', () => {
    const d = proj({
      'src/a.ts': '',
      'node_modules/pkg/i.js': '',
      'dist/bundle.js': '',
      'build/out.js': '',
      'out/x.js': '',
      '.git/hooks/pre-commit.js': ''
    })
    assert.deepEqual(entriesFromDirs(d), ['src'])
  })

  it('只有 markdown / 图片的目录不算源码目录', () => {
    assert.deepEqual(entriesFromDirs(proj({ 'docs/a.md': '', 'assets/b.png': '' })), [])
  })

  it('根目录下散着的源码文件也收进来（那种「一堆脚本」的项目）', () => {
    const d = proj({ 'build.js': '', 'serve.js': '', 'README.md': '' })
    assert.deepEqual(entriesFromDirs(d).sort(), ['build.js', 'serve.js'])
  })

  it('嵌一层的也认（engine/core/x.js）', () => {
    assert.deepEqual(entriesFromDirs(proj({ 'engine/core/x.js': '' })), ['engine'])
  })
})

describe('画不了的时候要说清看到了什么', () => {
  it('说出实际占多数的语言，而不是一句笼统的「没有源码」', () => {
    const d = proj({ 'a.py': '', 'b.py': '', 'c.py': '', 'ui/x.html': '' })
    const m = describeNonJs(d)
    assert.match(m, /Python/, m)
  })

  it('Swift 项目', () => {
    assert.match(describeNonJs(proj({ 'App/a.swift': '', 'App/b.swift': '' })), /Swift/)
  })

  it('只有文档时也说得出来', () => {
    assert.match(describeNonJs(proj({ 'a.md': '', 'b.md': '' })), /Markdown|文档/)
  })

  it('认不出的扩展名不硬编名字', () => {
    const m = describeNonJs(proj({ 'a.xyzzy': '', 'b.xyzzy': '' }))
    assert.match(m, /xyzzy/)
  })

  it('空目录不炸', () => {
    assert.equal(typeof describeNonJs(proj({})), 'string')
  })
})
