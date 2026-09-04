// `.gitignore` 的**目录**匹配。只回答一个问题：扫源码时该不该进这个目录。
//
// 为什么值得做：硬编「哪些目录不是源码」的名单永远列不全 ——
// 实测用户的「美颜」把 696 个第三方 C/C++ 文件放在 `third_party/`、
// 「口播相机」的构建产物在 `build-dev/` `build-sim/`，两个都不在任何通用名单里，
// 但**两个项目的 .gitignore 里都写着**。那份文件才是每个项目关于
// 「什么不是源码」的权威声明。

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { gitignoreDirMatcher } from './gitignore.ts'

const m = (text: string) => gitignoreDirMatcher(text)

describe('gitignoreDirMatcher', () => {
  it('bare 名字：任意深度都算', () => {
    const skip = m('build\n')
    assert.ok(skip('build'))
    assert.ok(skip('a/b/build'))
    assert.ok(!skip('builder'))
  })

  it('带尾斜杠的目录写法', () => {
    const skip = m('third_party/\n')
    assert.ok(skip('third_party'))
    assert.ok(skip('src/third_party'))
  })

  it('**通配符** —— 口播相机用的就是 build*/', () => {
    const skip = m('build*/\n')
    assert.ok(skip('build'))
    assert.ok(skip('build-dev'))
    assert.ok(skip('build-sim'))
    assert.ok(!skip('rebuild'))
  })

  it('带路径的模式锚在根上，不是任意深度', () => {
    const skip = m('tools/build/\n')
    assert.ok(skip('tools/build'))
    assert.ok(!skip('build'), 'tools/build 不该让顶层 build 也被跳过')
    assert.ok(!skip('a/tools/build'), '带斜杠的模式锚在根')
  })

  it('前导斜杠也是锚在根', () => {
    const skip = m('/out\n')
    assert.ok(skip('out'))
    assert.ok(!skip('src/out'))
  })

  it('注释和空行忽略', () => {
    const skip = m('# build\n\n   \nout\n')
    assert.ok(!skip('build'))
    assert.ok(skip('out'))
  })

  it('**否定规则整条忽略** —— 宁可多扫，不可漏扫', () => {
    const skip = m('build\n!build/keep\n')
    assert.ok(skip('build'), '否定规则不该让我们把 build 也扫进去')
  })

  it('文件模式（带扩展名）不当目录用', () => {
    const skip = m('*.o\n*.dylib\n')
    assert.ok(!skip('foo'))
    assert.ok(!skip('src'))
  })

  it('空 .gitignore 什么都不跳', () => {
    const skip = m('')
    assert.ok(!skip('anything'))
  })

  it('正则元字符按字面量处理，不当模式', () => {
    const skip = m('a+b\n')
    assert.ok(skip('a+b'))
    assert.ok(!skip('aab'))
  })
})
