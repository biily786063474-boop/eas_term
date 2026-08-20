import { test } from 'node:test'
import assert from 'node:assert/strict'
import { safeHistoryKey } from './agentHistoryKey.ts'

test('正常的 leafId 放行', () => {
  assert.equal(safeHistoryKey('leaf-57-kk9qf'), 'leaf-57-kk9qf')
  assert.equal(safeHistoryKey('a_B-9'), 'a_B-9')
})

test('路径穿越一律拒绝', () => {
  // 放行任何一个，写入就可能落到用户的配置文件上
  for (const bad of ['../x', '../../.claude.json', 'a/b', 'a\\b', '/abs', '.', '..', 'a/../b']) {
    assert.equal(safeHistoryKey(bad), null, `${bad} 必须被拒`)
  }
})

test('空、超长、含空白或特殊字符一律拒绝', () => {
  for (const bad of ['', ' ', 'a b', 'a\n', 'a\0b', 'a'.repeat(121), '中文', 'a;b', 'a$b']) {
    assert.equal(safeHistoryKey(bad), null, `${JSON.stringify(bad)} 必须被拒`)
  }
})
