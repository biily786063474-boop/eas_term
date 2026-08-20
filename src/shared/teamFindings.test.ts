import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deliveredOf, deliveredHint, THIN_BYTES } from './teamFindings.ts'

test('文件不存在 = missing，跟空文件分开', () => {
  // 「压根没建」和「建了但空着」对人的提示不一样，不能都归成一类
  assert.equal(deliveredOf(null), 'missing')
  assert.equal(deliveredOf(0), 'thin')
})

test('只有标题那点内容算 thin', () => {
  assert.equal(deliveredOf(THIN_BYTES - 1), 'thin')
  assert.equal(deliveredOf(THIN_BYTES), 'ok', '刚好到阈值就算数')
})

test('正常长度的结论是 ok', () => {
  assert.equal(deliveredOf(9614), 'ok')
})

test('missing 和 thin 都要给出「别当成完成」的话', () => {
  // 只报状态码的话，主 agent 还是会按 done 往下走
  assert.match(deliveredHint('missing', 'r1'), /没建|别把它当成完成/)
  assert.match(deliveredHint('thin', 'r1'), /没做完|标题/)
  assert.equal(deliveredHint('ok', 'r1'), '', 'ok 不该有噪音')
})

test('提示里带上角色名，否则一批人分不清是谁', () => {
  assert.ok(deliveredHint('missing', 'css-auditor').includes('css-auditor'))
})
