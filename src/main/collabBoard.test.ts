// 协同板的 git 输出解析。
//
// **为什么 import 的是 `gitExec.ts` 而不是 `collabBoard.ts`：** collabBoard.ts 顶上
// `import { ipcMain } from 'electron'`，而 node --test 里 electron 是个 CommonJS 包、
// 拿不到具名导出（实测报 `SyntaxError: Named export 'ipcMain' not found`），
// 整个测试文件当场加载失败。所以解析逻辑照 `roles.ts` → `builtinRoles.ts` 的老办法
// 拆进 electron-free 的 `gitExec.ts`，collabBoard.ts 再 re-export 一份给别处用。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parsePorcelain, parseNameOnly, unquoteGitPath } from './gitExec.ts'

test('普通的修改行与未跟踪行', () => {
  assert.deepEqual(parsePorcelain(' M a.ts\n?? b.ts'), ['a.ts', 'b.ts'])
})

test('两个状态位都认（暂存 + 工作区）', () => {
  assert.deepEqual(parsePorcelain('MM src/x.ts\nA  src/y.ts\n D src/z.ts'), [
    'src/x.ts',
    'src/y.ts',
    'src/z.ts'
  ])
})

// 这条是评审点名的那个 bug：`slice(3)` 会得到「old.ts -> new.ts」这么一个
// 根本不存在的路径，真正被改的 new.ts 反而不在清单里 —— 于是两条分支都改了
// new.ts 也判不出撞车（overlap 是按路径字符串比对的）。
test('重命名行取**新**路径，不是那一整串「旧 -> 新」', () => {
  assert.deepEqual(parsePorcelain('R  old.ts -> new.ts'), ['new.ts'])
  assert.deepEqual(parsePorcelain('RM a/old.ts -> a/new.ts'), ['a/new.ts'])
})

test('复制行（C）同样取新路径', () => {
  assert.deepEqual(parsePorcelain('C  src/a.ts -> src/b.ts'), ['src/b.ts'])
})

test('路径里带空格 —— 不能按空格切', () => {
  assert.deepEqual(parsePorcelain(' M docs/my notes.md\n?? a b c.txt'), [
    'docs/my notes.md',
    'a b c.txt'
  ])
})

// 名字里真带 ` -> ` 的普通文件不能被当成重命名拆坏 ——
// 所以判据是状态位 R/C，而不是「见到箭头就拆」。
test('名字里带 " -> " 的普通改动行不拆箭头', () => {
  assert.deepEqual(parsePorcelain(' M a -> b.md'), ['a -> b.md'])
})

// core.quotePath=false 之后中文路径是字面量。没有它的话这里会是
// `docs/\346\236\266\346\236\204.md`，板上乱码且 overlap 永远判不出来。
test('中文路径原样保留（靠 -c core.quotePath=false）', () => {
  assert.deepEqual(parsePorcelain(' M docs/架构图.md\n?? 笔记/待办.md'), [
    'docs/架构图.md',
    '笔记/待办.md'
  ])
})

test('中文路径的重命名行也取新路径', () => {
  assert.deepEqual(parsePorcelain('R  docs/旧名.md -> docs/新名.md'), ['docs/新名.md'])
})

test('空行、空输入、太短的行一律跳过', () => {
  assert.deepEqual(parsePorcelain(''), [])
  assert.deepEqual(parsePorcelain('\n\n'), [])
  assert.deepEqual(parsePorcelain(' M a.ts\n\n?? b.ts\n'), ['a.ts', 'b.ts'])
})

test('带引号的路径要脱引号（quotePath=false 只管非 ASCII，引号/反斜杠照旧会被引起来）', () => {
  assert.equal(unquoteGitPath('"a\\"b.txt"'), 'a"b.txt')
  assert.equal(unquoteGitPath('"a\\\\b.txt"'), 'a\\b.txt')
  assert.equal(unquoteGitPath('plain.txt'), 'plain.txt')
  assert.deepEqual(parsePorcelain('?? "weird\\"name.txt"'), ['weird"name.txt'])
})

test('diff --name-only 一行一个路径，也要脱引号', () => {
  assert.deepEqual(parseNameOnly('src/a.ts\ndocs/架构图.md\n'), ['src/a.ts', 'docs/架构图.md'])
  assert.deepEqual(parseNameOnly(''), [])
})
