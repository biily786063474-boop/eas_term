import { test } from 'node:test'
import assert from 'node:assert/strict'
import { approvalEnv } from './approvalEnv.ts'

// 这一条就是 2026-08-31 那个 bug 的回归测试
test('**没启用审批时不打标记** —— 否则用户仓库里残留的旧 hook 会继续拦每一次工具调用', () => {
  assert.deepEqual(approvalEnv('sess-1', true), {})
})

test('启用了审批才打标记 —— hook 靠它认出「这次调用是 agent-chat 会话发起的」', () => {
  assert.deepEqual(approvalEnv('sess-1', false), { EAS_AGENT_CHAT_SESSION: 'sess-1' })
})

// SessionRecord 里这个字段是可选的，从磁盘恢复的老记录可能没有
test('**undefined 也不打标记** —— 老会话恢复回来不该又被残留 hook 拦上', () => {
  assert.deepEqual(approvalEnv('sess-1', undefined), {})
})

test('标记里带的是这个会话自己的 id，审批路由靠它点名找回来', () => {
  assert.equal(approvalEnv('abc', false).EAS_AGENT_CHAT_SESSION, 'abc')
  assert.equal(approvalEnv('xyz', false).EAS_AGENT_CHAT_SESSION, 'xyz')
})
