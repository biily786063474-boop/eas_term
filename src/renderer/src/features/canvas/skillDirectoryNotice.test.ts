import { test } from 'node:test'
import assert from 'node:assert/strict'
import { skillDirectoryNotice } from './skillDirectoryNotice.ts'

test('missing project directory is an optional empty state', () => {
  const notice = skillDirectoryNotice('这个目录不存在', true)
  assert.equal(notice.empty, true)
  assert.match(notice.description, /全局技能仍可使用/)
})
test('global missing directory explains next step', () => {
  assert.match(skillDirectoryNotice('这个目录不存在', false).description, /选择已有目录/)
})
test('permission and other read failures remain explicit', () => {
  for (const error of ['没有权限读取这个目录', '这不是一个文件夹', '未知读取错误']) {
    const notice = skillDirectoryNotice(error, true)
    assert.equal(notice.empty, false)
    assert.equal(notice.description, error)
  }
})

test('missing error details still explain failure', () => {
  assert.equal(skillDirectoryNotice(undefined, true).empty, false)
  assert.match(skillDirectoryNotice(undefined, true).description, /读取失败/)
})
