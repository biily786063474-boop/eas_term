import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeDecision,
  hookResponseBody,
  approvalIdOf,
  waitForApproval,
  resolveApproval,
  APPROVAL_TIMEOUT_MS
} from './approvalRoute.ts'

test('超时兜底是拒绝，不是允许', () => {
  // 这条是安全底线：前端崩了/用户没看见时，绝不能默默放行一个写文件或跑命令的请求
  assert.equal(normalizeDecision(undefined), 'deny')
  assert.equal(normalizeDecision(null), 'deny')
  assert.equal(normalizeDecision('乱七八糟'), 'deny')
})

test('只有明确的 allow 才是允许', () => {
  assert.equal(normalizeDecision('allow'), 'allow')
  assert.equal(normalizeDecision('deny'), 'deny')
})

test('hook 响应体是 Claude 认的那个形状', () => {
  const body = JSON.parse(hookResponseBody('allow', '用户在 Eas-Term 里点了允许'))
  assert.equal(body.hookSpecificOutput.hookEventName, 'PreToolUse')
  assert.equal(body.hookSpecificOutput.permissionDecision, 'allow')
  assert.equal(typeof body.hookSpecificOutput.permissionDecisionReason, 'string')
})

test('审批等待有上限，且不短于一分钟', () => {
  // 太短会在用户还在看的时候自己拒掉
  assert.ok(APPROVAL_TIMEOUT_MS >= 60_000)
})

// ---- 以下是简报没写、但实现涉及的字段/分支，补充断言（按 Ruling 7 的要求） ----

test('hook 响应体的 reason 字段原样带出，不是占位符', () => {
  // 只测字段类型是 string 测不出「reason 被写死成固定字符串」这种坑，补一条精确值断言
  const body = JSON.parse(hookResponseBody('deny', '用户点了拒绝'))
  assert.equal(body.hookSpecificOutput.permissionDecisionReason, '用户点了拒绝')
})

test('hook 响应体的 decision 精确透传，不是恒定值', () => {
  // 只用一种 decision 调用测不出「permissionDecision 被写死」这种坑，两种都验一遍
  const allow = JSON.parse(hookResponseBody('allow', ''))
  const deny = JSON.parse(hookResponseBody('deny', ''))
  assert.equal(allow.hookSpecificOutput.permissionDecision, 'allow')
  assert.equal(deny.hookSpecificOutput.permissionDecision, 'deny')
})

test('approvalIdOf 从 hook payload 里取 tool_use_id', () => {
  assert.equal(approvalIdOf({ tool_use_id: 'toolu_1' }), 'toolu_1')
})

test('approvalIdOf 对缺字段/畸形输入兜底返回空串，不抛', () => {
  assert.equal(approvalIdOf({}), '')
  assert.equal(approvalIdOf(null), '')
  assert.equal(approvalIdOf(undefined), '')
  assert.equal(approvalIdOf('乱七八糟'), '')
  assert.equal(approvalIdOf({ tool_use_id: 123 }), '', 'tool_use_id 不是字符串时也要兜底')
})

test('waitForApproval 挂起直到 resolveApproval 命中，拿到对应的 decision/reason', async () => {
  const pending = waitForApproval('appr-1')
  assert.equal(resolveApproval('appr-1', 'allow', '用户点了允许'), true)
  const r = await pending
  assert.deepEqual(r, { decision: 'allow', reason: '用户点了允许' })
})

test('waitForApproval 超时后兜底 deny——不用等真实的 5 分钟，注入短超时验证', async () => {
  const r = await waitForApproval('appr-timeout', 20)
  assert.equal(r.decision, 'deny')
  assert.equal(typeof r.reason, 'string')
  assert.ok(r.reason.length > 0, '超时也要给出人能看懂的理由，不是空字符串')
})

test('resolveApproval 命中不存在的 approvalId 返回 false，不抛', () => {
  assert.doesNotThrow(() => resolveApproval('没这个id', 'allow', ''))
  assert.equal(resolveApproval('没这个id', 'allow', ''), false)
})

test('resolveApproval 对同一个 approvalId 第二次调用返回 false（已被消费，不会重复 settle）', async () => {
  const pending = waitForApproval('appr-2')
  assert.equal(resolveApproval('appr-2', 'allow', ''), true)
  assert.equal(resolveApproval('appr-2', 'allow', ''), false, '第二次不该再命中')
  await pending
})

test('resolveApproval 对非法 decision 兜底成 deny，不直接透传渲染层传来的原始值', () => {
  const pending = waitForApproval('appr-3')
  resolveApproval('appr-3', '乱七八糟', '')
  return pending.then((r) => assert.equal(r.decision, 'deny'))
})

test('resolveApproval 的 reason 非字符串时兜底成空串，不把非法类型带进响应体', async () => {
  const pending = waitForApproval('appr-4')
  resolveApproval('appr-4', 'allow', 12345)
  const r = await pending
  assert.equal(r.reason, '')
})
