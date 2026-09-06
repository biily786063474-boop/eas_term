import { test } from 'node:test'
import assert from 'node:assert/strict'
import { denyMessage, grantFor, GRANT_MINUTES, remainingText, stateOf } from './grant.ts'

const T0 = 1_700_000_000_000

test('**没有永不过期这一档**', () => {
  assert.deepEqual([...GRANT_MINUTES], [5, 10, 30])
  assert.equal(grantFor(0, T0, 'p1'), null)
  assert.equal(grantFor(99999, T0, 'p1'), null)
  assert.equal(grantFor(Infinity, T0, 'p1'), null)
})

test('授权 10 分钟：期内有效，到点即失效', () => {
  const g = grantFor(10, T0, 'panel-1')!
  assert.ok(stateOf(g, T0 + 60_000).active)
  assert.ok(stateOf(g, T0 + 9 * 60_000 + 59_000).active)
  const after = stateOf(g, T0 + 10 * 60_000)
  assert.equal(after.active, false)
  if (!after.active) assert.equal(after.reason, 'expired')
})

test('从没授过 / 刚被收回 要分得开（面板文案不一样）', () => {
  const never = stateOf(null, T0)
  assert.equal(never.active === false && never.reason, 'never')
  const rev = stateOf(grantFor(10, T0, 'p')!, T0 + 1000, true)
  assert.equal(rev.active === false && rev.reason, 'revoked')
})

test('拒绝时要说怎么办，不能只说不行', () => {
  for (const s of [stateOf(null, T0), stateOf(grantFor(5, T0, 'p')!, T0 + 10 * 60_000)]) {
    const m = denyMessage(s)
    assert.match(m, /面板/)
    assert.match(m, /允许操作/)
  }
  assert.match(denyMessage(stateOf(null, T0)), /截图不受影响/)
})

test('倒计时文案；到期显示未授权而不是负数', () => {
  const g = grantFor(10, T0, 'p')!
  assert.equal(remainingText(stateOf(g, T0)), '10:00')
  assert.equal(remainingText(stateOf(g, T0 + 9 * 60_000 + 30_000)), '0:30')
  assert.equal(remainingText(stateOf(g, T0 + 999 * 60_000)), '未授权')
})
