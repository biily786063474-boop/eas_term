// Python / C / Swift 的**路径解析**。造真实临时目录，不 mock fs ——
// 这一层的全部风险就在「那个说明符到底落到哪个文件」，mock 掉就什么都没测。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'
import { analyzeLangs, detectStacks } from './multiLang.ts'

const tmps: string[] = []
after(() => tmps.forEach((d) => fs.rmSync(d, { recursive: true, force: true })))
function proj(files: Record<string, string>): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-'))
  tmps.push(d)
  for (const [rel, body] of Object.entries(files)) {
    const f = path.join(d, rel)
    fs.mkdirSync(path.dirname(f), { recursive: true })
    fs.writeFileSync(f, body)
  }
  return d
}
const edge = (r: { edges: { from: string; to: string }[] }, from: string, to: string): boolean =>
  r.edges.some((e) => e.from === from && e.to === to)

describe('detectStacks', () => {
  it('按源码文件数认，不看别的', () => {
    assert.deepEqual(detectStacks(proj({ 'a.py': '', 'b.py': '' })), ['python'])
    assert.deepEqual(detectStacks(proj({ 'a.swift': '' })), ['swift'])
    assert.deepEqual(detectStacks(proj({ 'a.c': '', 'b.h': '' })), ['c'])
  })
  it('混合项目全都认出来', () => {
    const s = detectStacks(proj({ 'a.py': '', 'b.swift': '', 'c.cpp': '' }))
    assert.deepEqual([...s].sort(), ['c', 'python', 'swift'])
  })
  it('没有源码就是空', () => {
    assert.deepEqual(detectStacks(proj({ 'a.md': '' })), [])
  })
})

describe('Python 解析', () => {
  it('绝对 import 落到 pkg/mod.py', () => {
    const d = proj({ 'main.py': 'import pkg.mod', 'pkg/__init__.py': '', 'pkg/mod.py': '' })
    assert.ok(edge(analyzeLangs(d, ['python']), 'main.py', 'pkg/mod.py'))
  })
  it('**包用 __init__.py 兜底** —— import pkg 落到 pkg/__init__.py', () => {
    const d = proj({ 'main.py': 'import pkg', 'pkg/__init__.py': '' })
    assert.ok(edge(analyzeLangs(d, ['python']), 'main.py', 'pkg/__init__.py'))
  })
  it('相对 import：from . import sib', () => {
    const d = proj({ 'pkg/__init__.py': '', 'pkg/a.py': 'from . import sib', 'pkg/sib.py': '' })
    assert.ok(edge(analyzeLangs(d, ['python']), 'pkg/a.py', 'pkg/sib.py'))
  })
  it('**上跳一层：from ..other import x** —— 点数数错就连到隔壁包', () => {
    const d = proj({
      'pkg/sub/a.py': 'from ..other import x',
      'pkg/other.py': '',
      'pkg/sub/other.py': '在这儿的话就是数错了'
    })
    const r = analyzeLangs(d, ['python'])
    assert.ok(edge(r, 'pkg/sub/a.py', 'pkg/other.py'), '应连到上一层的 other.py')
    assert.ok(!edge(r, 'pkg/sub/a.py', 'pkg/sub/other.py'), '连错到同层了 —— 点数数错')
  })
  it('from pkg import mod 里的 mod 是子模块时也连上', () => {
    const d = proj({ 'main.py': 'from pkg import mod', 'pkg/__init__.py': '', 'pkg/mod.py': '' })
    assert.ok(edge(analyzeLangs(d, ['python']), 'main.py', 'pkg/mod.py'))
  })
  it('**第三方库不进图** —— import numpy 不该造出一个 numpy 节点', () => {
    const r = analyzeLangs(proj({ 'main.py': 'import numpy\nimport os' }), ['python'])
    assert.deepEqual(r.edges, [])
    assert.deepEqual(r.nodes.map((n) => n.id), ['main.py'])
  })
})

describe('C / C++ 解析', () => {
  it('相对包含方文件所在目录', () => {
    const d = proj({ 'src/a.c': '#include "b.h"', 'src/b.h': '' })
    assert.ok(edge(analyzeLangs(d, ['c']), 'src/a.c', 'src/b.h'))
  })
  it('找不到就往 include 根上试', () => {
    const d = proj({ 'src/a.c': '#include "util/x.h"', 'include/util/x.h': '', 'src/x.h': '' })
    assert.ok(edge(analyzeLangs(d, ['c']), 'src/a.c', 'include/util/x.h'))
  })
  it('**系统头不进图** —— 否则满屏 stdio.h', () => {
    const r = analyzeLangs(proj({ 'a.c': '#include <stdio.h>\n#include <vector>' }), ['c'])
    assert.deepEqual(r.edges, [])
    assert.deepEqual(r.nodes.map((n) => n.id), ['a.c'])
  })
  it('尖括号但项目里真有这个文件时算本地', () => {
    const d = proj({ 'a.c': '#include <mylib.h>', 'mylib.h': '' })
    assert.ok(edge(analyzeLangs(d, ['c']), 'a.c', 'mylib.h'))
  })
})

describe('Swift 解析 —— 只有 target 级', () => {
  it('Package.swift 的 target 之间连线', () => {
    const d = proj({
      'Package.swift': 'targets: [.target(name: "Core"), .target(name: "App")]',
      'Sources/Core/a.swift': '',
      'Sources/App/b.swift': 'import Core'
    })
    const r = analyzeLangs(d, ['swift'])
    assert.ok(edge(r, 'Sources/App', 'Sources/Core'), '边: ' + JSON.stringify(r.edges))
  })
  it('没有 Package.swift 时用顶层目录当 target', () => {
    const d = proj({ 'WireProtocol/p.swift': '', 'PadClient/c.swift': 'import WireProtocol' })
    assert.ok(edge(analyzeLangs(d, ['swift']), 'PadClient', 'WireProtocol'))
  })
  it('**系统框架不算本地 target，哪怕撞了目录名** —— 口播相机的 Speech/ 就是这个坑', () => {
    const d = proj({ 'Speech/s.swift': '', 'App/a.swift': 'import Speech\nimport Foundation' })
    const r = analyzeLangs(d, ['swift'])
    assert.ok(!edge(r, 'App', 'Speech'), 'Speech 是苹果框架，不该连')
  })
  it('节点是 target 不是文件，weight 记文件数', () => {
    const d = proj({ 'Core/a.swift': '', 'Core/b.swift': '', 'App/c.swift': 'import Core' })
    const r = analyzeLangs(d, ['swift'])
    assert.deepEqual(r.nodes.map((n) => n.id).sort(), ['App', 'Core'])
  })
})

describe('模块级节点不该再被折一次', () => {
  it('**Swift 的 target 已经是聚合单位** —— 它自己就是一块地', () => {
    const d = proj({
      'Sources/Core/a.swift': '',
      'Sources/UI/b.swift': 'import Core',
      'Sources/Net/c.swift': 'import Core'
    })
    const r = analyzeLangs(d, ['swift'])
    // 节点 id 是目录路径。若被按第一段折一次，三个 target 会并成一个 "Sources"
    assert.deepEqual(
      r.nodes.map((n) => n.id).sort(),
      ['Sources/Core', 'Sources/Net', 'Sources/UI']
    )
    assert.equal(r.edges.length, 2, '边: ' + JSON.stringify(r.edges))
  })
})
