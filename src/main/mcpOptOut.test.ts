import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shouldAutoInstall, optOutPayload } from './mcpOptOut.ts'

test('没有标记文件 → 装（绝大多数用户）', () => {
  assert.equal(shouldAutoInstall(null), true)
})

test('明确拒绝过 → 不装', () => {
  assert.equal(shouldAutoInstall('{"optedOut":true}'), false)
  assert.equal(shouldAutoInstall(optOutPayload(true, 1_700_000_000_000)), false)
})

test('明确没拒绝 → 装', () => {
  assert.equal(shouldAutoInstall('{"optedOut":false}'), true)
  assert.equal(shouldAutoInstall(optOutPayload(false, 0)), true)
})

test('文件坏了一律倒向「装」—— 不装的代价大得多', () => {
  // 不装 = 画板工具整个不可用，而且界面显示「未启用」却看不出原因；
  // 误装 = 用户再点一次移除。两边代价不对等，异常必须倒向后者
  for (const bad of ['', 'not json', '{', 'null', '[]', '{"optedOut":', '123']) {
    assert.equal(shouldAutoInstall(bad), true, `坏内容 ${JSON.stringify(bad)} 应该照常装`)
  }
})

test('只认严格的 true，不猜用户意图', () => {
  // 字符串 'true' / 1 这类值不能当成拒绝——它们更可能是别的程序写坏的
  for (const v of ['{"optedOut":"true"}', '{"optedOut":1}', '{"optedOut":"yes"}']) {
    assert.equal(shouldAutoInstall(v), true, `${v} 不该被当成明确拒绝`)
  }
})

test('payload 带上时刻，方便排障时知道什么时候关的', () => {
  const p = JSON.parse(optOutPayload(true, 1_700_000_000_000))
  assert.equal(p.optedOut, true)
  assert.equal(p.at, 1_700_000_000_000)
})
