import { test } from 'node:test'
import assert from 'node:assert'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { resolveBuiltinDirs, mergeDirs, planAddDir, planRemoveDir } from './dirs.ts'

test('resolveBuiltinDirs：四个内置目录，路径都拼在 home 下', () => {
  const dirs = resolveBuiltinDirs('/Users/x')
  assert.equal(dirs.length, 4)
  assert.ok(dirs.every((d) => d.builtin))
  assert.deepStrictEqual(
    dirs.map((d) => d.path),
    [
      '/Users/x/.claude/skills',
      '/Users/x/.codex/skills',
      '/Users/x/.claude/design-skills',
      '/Users/x/.claude/motion-skills'
    ]
  )
})

test('mergeDirs：内置在前，自定义追加在后', () => {
  const builtin = resolveBuiltinDirs('/h')
  const custom = [{ id: 'custom:/a', label: 'a', path: '/a', builtin: false }]
  const out = mergeDirs(builtin, custom)
  assert.equal(out.length, 5)
  assert.equal(out[4].id, 'custom:/a')
})

test('mergeDirs：自定义 id 撞了内置 id 时，撞车的那条被丢弃（内置优先级更高）', () => {
  const builtin = resolveBuiltinDirs('/h')
  const custom = [{ id: 'claude-global', label: '冒充的', path: '/evil', builtin: false }]
  const out = mergeDirs(builtin, custom)
  assert.equal(out.length, 4) // 没有变成 5 条
  assert.equal(out.find((d) => d.id === 'claude-global')?.path, '/h/.claude/skills')
})

test('planAddDir：空路径 / 相对路径都拒绝', () => {
  assert.equal(planAddDir([], '').ok, false)
  assert.equal(planAddDir([], '   ').ok, false)
  assert.equal(planAddDir([], 'relative/path').ok, false)
  assert.equal(planAddDir([], undefined).ok, false)
  assert.equal(planAddDir([], 123).ok, false)
})

test('planAddDir：目录不存在 → 拒绝', () => {
  const r = planAddDir([], '/this/path/should/not/exist/xyz-123')
  assert.equal(r.ok, false)
  if (!r.ok) assert.match(r.error, /不存在|读不到/)
})

test('planAddDir：路径存在但是个文件而不是目录 → 拒绝', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skilldir-'))
  const file = path.join(dir, 'notadir.txt')
  fs.writeFileSync(file, 'x')
  const r = planAddDir([], file)
  assert.equal(r.ok, false)
  if (!r.ok) assert.match(r.error, /文件夹/)
})

test('planAddDir：合法目录 → 成功，id 以 custom: 开头，label 默认取目录名', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'my-skills-'))
  const r = planAddDir([], dir)
  assert.equal(r.ok, true)
  if (r.ok) {
    assert.ok(r.entry.id.startsWith('custom:'))
    assert.equal(r.entry.builtin, false)
    assert.equal(r.entry.label, path.basename(fs.realpathSync(dir)))
  }
})

test('planAddDir：自定义 label 会被使用（去掉首尾空格）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'my-skills-'))
  const r = planAddDir([], dir, '  我的技能库  ')
  assert.equal(r.ok, true)
  if (r.ok) assert.equal(r.entry.label, '我的技能库')
})

test('planAddDir：重复添加同一个目录 → 拒绝（同一路径两次调用，id 相同）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'my-skills-'))
  const first = planAddDir([], dir)
  assert.equal(first.ok, true)
  if (!first.ok) return
  const second = planAddDir([first.entry], dir)
  assert.equal(second.ok, false)
  if (!second.ok) assert.match(second.error, /已经在列表里/)
})

test('planAddDir：通过两个不同的字符串路径（一个带多余的 /./）指向同一个真实目录 → 仍判定为重复', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'my-skills-'))
  const first = planAddDir([], dir)
  assert.equal(first.ok, true)
  if (!first.ok) return
  const messyPath = path.join(dir, '.', '')
  const second = planAddDir([first.entry], messyPath)
  assert.equal(second.ok, false)
})

test('planRemoveDir：按 id 删除自定义目录', () => {
  const list = [
    { id: 'custom:/a', label: 'a', path: '/a', builtin: false },
    { id: 'custom:/b', label: 'b', path: '/b', builtin: false }
  ]
  const out = planRemoveDir(list, 'custom:/a')
  assert.deepStrictEqual(out.map((d) => d.id), ['custom:/b'])
})

test('planRemoveDir：id 不存在时原样返回，不抛错', () => {
  const list = [{ id: 'custom:/a', label: 'a', path: '/a', builtin: false }]
  const out = planRemoveDir(list, 'custom:/not-there')
  assert.equal(out.length, 1)
})
