// 各语言的 import 提取。**纯字符串进、说明符出，不碰 fs** —— 解析路径是下一层的事。
//
// 这一层判断错了的表现最隐蔽：图照样画得出来，只是少了几条边，
// 而「少了边」和「本来就没依赖」在图上长得一模一样。

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { extractCInclude, extractPythonImport, extractSwiftImport } from './langImports.ts'

describe('Python', () => {
  it('import a.b.c', () => {
    assert.deepEqual(extractPythonImport('import os.path'), [{ module: 'os.path', level: 0 }])
  })
  it('from a.b import c', () => {
    assert.deepEqual(extractPythonImport('from pkg.sub import thing'), [
      { module: 'pkg.sub', level: 0, names: ['thing'] }
    ])
  })
  it('**相对 import 的点数要数准** —— 少数一个点就跑到隔壁包去了', () => {
    assert.deepEqual(extractPythonImport('from . import x'), [{ module: '', level: 1, names: ['x'] }])
    assert.deepEqual(extractPythonImport('from .mod import y'), [
      { module: 'mod', level: 1, names: ['y'] }
    ])
    assert.deepEqual(extractPythonImport('from ..pkg.m import z'), [
      { module: 'pkg.m', level: 2, names: ['z'] }
    ])
  })
  it('一行多个：import a, b', () => {
    assert.deepEqual(extractPythonImport('import a, b.c'), [
      { module: 'a', level: 0 },
      { module: 'b.c', level: 0 }
    ])
  })
  it('as 别名不影响模块名', () => {
    assert.deepEqual(extractPythonImport('import numpy as np'), [{ module: 'numpy', level: 0 }])
    assert.deepEqual(extractPythonImport('from .a import b as c'), [
      { module: 'a', level: 1, names: ['b'] }
    ])
  })
  it('括号里的多行 from-import', () => {
    const src = 'from .mod import (\n    alpha,\n    beta,\n)\n'
    assert.deepEqual(extractPythonImport(src), [{ module: 'mod', level: 1, names: ['alpha', 'beta'] }])
  })
  it('**缩进的 import 也算** —— 函数里的延迟导入是真实依赖', () => {
    assert.deepEqual(extractPythonImport('def f():\n    import json\n'), [
      { module: 'json', level: 0 }
    ])
  })
  it('注释掉的不算', () => {
    assert.deepEqual(extractPythonImport('# import fake\nx = 1'), [])
  })
  it('字符串里长得像 import 的不算', () => {
    assert.deepEqual(extractPythonImport('s = "import fake"'), [])
  })
})

describe('C / C++', () => {
  it('本地头用引号', () => {
    assert.deepEqual(extractCInclude('#include "foo.h"'), [{ path: 'foo.h', local: true }])
  })
  it('**尖括号是系统头，标出来** —— 混进去会让图上全是 stdio.h', () => {
    assert.deepEqual(extractCInclude('#include <stdio.h>'), [{ path: 'stdio.h', local: false }])
  })
  it('# 和 include 之间允许空格', () => {
    assert.deepEqual(extractCInclude('#  include "a/b.hpp"'), [{ path: 'a/b.hpp', local: true }])
  })
  it('行首缩进也认', () => {
    assert.deepEqual(extractCInclude('   #include "x.h"'), [{ path: 'x.h', local: true }])
  })
  it('注释掉的不算', () => {
    assert.deepEqual(extractCInclude('// #include "no.h"'), [])
    assert.deepEqual(extractCInclude('/* #include "no.h" */'), [])
  })
  it('多行取全部', () => {
    assert.deepEqual(extractCInclude('#include "a.h"\n#include <b.h>\n#include "c.h"').length, 3)
  })
})

describe('Swift', () => {
  it('import Foundation', () => {
    assert.deepEqual(extractSwiftImport('import Foundation'), ['Foundation'])
  })
  it('**带 kind 的 import 取模块名** —— import struct A.B 里模块是 A', () => {
    assert.deepEqual(extractSwiftImport('import struct WireProtocol.Packet'), ['WireProtocol'])
    assert.deepEqual(extractSwiftImport('import class Foundation.NSString'), ['Foundation'])
  })
  it('@testable import 也算', () => {
    assert.deepEqual(extractSwiftImport('@testable import GestureCore'), ['GestureCore'])
  })
  it('注释掉的不算', () => {
    assert.deepEqual(extractSwiftImport('// import Fake'), [])
  })
  it('去重', () => {
    assert.deepEqual(extractSwiftImport('import A\nimport A\nimport B'), ['A', 'B'])
  })
})
