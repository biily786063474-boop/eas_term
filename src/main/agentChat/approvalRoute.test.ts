import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeDecision,
  hookResponseBody,
  approvalIdOf,
  waitForApproval,
  resolveApproval,
  onApprovalRequest,
  onApprovalSettled,
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
  const pending = waitForApproval({ tool_use_id: 'appr-1' })
  assert.equal(resolveApproval('appr-1', 'allow', '用户点了允许'), true)
  const r = await pending
  assert.deepEqual(r, { decision: 'allow', reason: '用户点了允许' })
})

test('waitForApproval 超时后兜底 deny——不用等真实的 5 分钟，注入短超时验证', async () => {
  const r = await waitForApproval({ tool_use_id: 'appr-timeout' }, 20)
  assert.equal(r.decision, 'deny')
  assert.equal(typeof r.reason, 'string')
  assert.ok(r.reason.length > 0, '超时也要给出人能看懂的理由，不是空字符串')
})

test('waitForApproval 对缺 tool_use_id 的 payload 立即兜底 deny，不登记不挂起', async () => {
  const r = await waitForApproval({ tool_name: 'Bash' })
  assert.equal(r.decision, 'deny')
  assert.ok(r.reason.length > 0)
})

test('resolveApproval 命中不存在的 approvalId 返回 false，不抛', () => {
  assert.doesNotThrow(() => resolveApproval('没这个id', 'allow', ''))
  assert.equal(resolveApproval('没这个id', 'allow', ''), false)
})

test('resolveApproval 对同一个 approvalId 第二次调用返回 false（已被消费，不会重复 settle）', async () => {
  const pending = waitForApproval({ tool_use_id: 'appr-2' })
  assert.equal(resolveApproval('appr-2', 'allow', ''), true)
  assert.equal(resolveApproval('appr-2', 'allow', ''), false, '第二次不该再命中')
  await pending
})

test('resolveApproval 对非法 decision 兜底成 deny，不直接透传渲染层传来的原始值', () => {
  const pending = waitForApproval({ tool_use_id: 'appr-3' })
  resolveApproval('appr-3', '乱七八糟', '')
  return pending.then((r) => assert.equal(r.decision, 'deny'))
})

test('resolveApproval 的 reason 非字符串时兜底成空串，不把非法类型带进响应体', async () => {
  const pending = waitForApproval({ tool_use_id: 'appr-4' })
  resolveApproval('appr-4', 'allow', 12345)
  const r = await pending
  assert.equal(r.reason, '')
})

// ---- payload 留存与订阅（审查发现的 Important 修复：payload 曾被丢弃，只留 approvalId） ----

// 下面这组测试统一给 waitForApproval 传短超时（而不是用默认的 5 分钟）：不是为了测超时
// 本身，是防御性写法——如果广播逻辑真的坏了（listener 没收到/收到了不该收到的），
// 前面的 assert 会先抛，抛的话下面「用 resolveApproval 收尾」那行就不会执行，
// pending 这个 promise 会用默认超时一直挂着。真的挂过一次：写这组测试时一度让
// npm test 卡住超过 120 秒才发现——用短超时兜底之后，任何断言失败都会在几秒内
// 让整条测试链路 fail fast，而不是把 CI 拖到 5 分钟开外。

test('waitForApproval 把完整 payload（不只是 approvalId）广播给订阅者', async () => {
  const seen: unknown[] = []
  const unsubscribe = onApprovalRequest((p) => seen.push(p))
  const payload = {
    session_id: 's1',
    cwd: '/work/proj',
    tool_name: 'Bash',
    tool_input: { command: 'echo hi' },
    tool_use_id: 'appr-payload-1'
  }
  const pending = waitForApproval(payload, 5_000)
  unsubscribe()
  assert.equal(seen.length, 1)
  // 精确 deepEqual，不是只查某个字段——tool_name/tool_input/cwd 都必须原样在场，
  // 这几个正是审批卡片要显示的内容，之前的实现里全被丢了
  assert.deepEqual(seen[0], payload)
  resolveApproval('appr-payload-1', 'allow', '')
  await pending
})

test('onApprovalRequest 返回的取消订阅函数生效后不再收到通知', async () => {
  const seen: unknown[] = []
  const unsubscribe = onApprovalRequest((p) => seen.push(p))
  unsubscribe()
  const pending = waitForApproval({ tool_use_id: 'appr-payload-2' }, 5_000)
  assert.equal(seen.length, 0, '取消订阅之后不该再收到')
  resolveApproval('appr-payload-2', 'allow', '')
  await pending
})

test('多个订阅者都能收到同一次请求的 payload', async () => {
  const a: unknown[] = []
  const b: unknown[] = []
  const unsubA = onApprovalRequest((p) => a.push(p))
  const unsubB = onApprovalRequest((p) => b.push(p))
  const pending = waitForApproval({ tool_use_id: 'appr-payload-3' }, 5_000)
  unsubA()
  unsubB()
  assert.equal(a.length, 1)
  assert.equal(b.length, 1)
  resolveApproval('appr-payload-3', 'allow', '')
  await pending
})

test('订阅者在收到通知时同步调用 resolveApproval 也能命中（通知发生在登记之后）', async () => {
  // 这条锁住实现顺序：waiters.set(...) 必须先于通知订阅者，否则订阅者同步 resolve 时
  // 表里还没有这个 approvalId，会被误判成"没有这个请求"（resolveApproval 返回 false，
  // 决定永远等不到人工响应，只能靠超时兜底——不是错误行为，但白白等了 5 分钟）。
  let sawHitInsideListener = false
  const unsubscribe = onApprovalRequest((p) => {
    const id = (p as { tool_use_id: string }).tool_use_id
    sawHitInsideListener = resolveApproval(id, 'allow', '订阅者同步命中')
  })
  // 短超时兜底：正常实现下这个 promise 应该被监听器同步 resolve，几乎立即 settle；
  // 传短超时只是防止"顺序错了导致监听器落空"这类回归把测试拖到真实的 5 分钟默认值
  // 才失败——测试要快速给出明确的红，不该在 CI 里挂 5 分钟。
  const r = await waitForApproval({ tool_use_id: 'appr-payload-4' }, 5_000)
  unsubscribe()
  assert.equal(sawHitInsideListener, true)
  assert.deepEqual(r, { decision: 'allow', reason: '订阅者同步命中' })
})

test('approvalId 缺失时不广播给订阅者——没法登记，广播了也没人能 resolve', async () => {
  const seen: unknown[] = []
  const unsubscribe = onApprovalRequest((p) => seen.push(p))
  const r = await waitForApproval({})
  unsubscribe()
  assert.equal(seen.length, 0)
  assert.equal(r.decision, 'deny')
})

// ---- onApprovalSettled（2026-08-14 全分支评审 I1 修复：超时后事件流会说谎）----
//
// 修复前：session.ts 的 IPC 处理直接拿渲染层"想要"的 decision 发 approval.resolved
// 事件，不管 resolveApproval() 实际返回 true 还是 false。下面这组测试直接锁住
// "敲定结果只能来自这里广播的真相"这条约束，且覆盖两条敲定路径（显式 resolve / 超时）。

test('resolveApproval 命中时，onApprovalSettled 收到同一个 approvalId 与实际敲定的 decision', async () => {
  const seen: { approvalId: string; decision: string }[] = []
  const unsubscribe = onApprovalSettled((approvalId, decision) => seen.push({ approvalId, decision }))
  const pending = waitForApproval({ tool_use_id: 'settled-1' }, 5_000)
  resolveApproval('settled-1', 'allow', '')
  await pending
  unsubscribe()
  assert.equal(seen.length, 1)
  assert.deepEqual(seen[0], { approvalId: 'settled-1', decision: 'allow' })
})

test('resolveApproval 传入非法 decision 时，onApprovalSettled 收到的是归一化后的 deny，不是原始垃圾值', async () => {
  const seen: string[] = []
  const unsubscribe = onApprovalSettled((_id, decision) => seen.push(decision))
  const pending = waitForApproval({ tool_use_id: 'settled-2' }, 5_000)
  resolveApproval('settled-2', '乱七八糟', '')
  await pending
  unsubscribe()
  assert.deepEqual(seen, ['deny'])
})

test('超时也会广播 onApprovalSettled，decision 固定是 deny——这是本条修复要补的那一半', async () => {
  const seen: { approvalId: string; decision: string }[] = []
  const unsubscribe = onApprovalSettled((approvalId, decision) => seen.push({ approvalId, decision }))
  await waitForApproval({ tool_use_id: 'settled-timeout' }, 20)
  unsubscribe()
  assert.equal(seen.length, 1)
  assert.deepEqual(seen[0], { approvalId: 'settled-timeout', decision: 'deny' })
})

test('核心回归场景：超时之后才迟到的 resolveApproval——不广播第二次，且返回 false（这正是 I1 描述的"事后才点允许"）', async () => {
  const seen: { approvalId: string; decision: string }[] = []
  const unsubscribe = onApprovalSettled((approvalId, decision) => seen.push({ approvalId, decision }))
  await waitForApproval({ tool_use_id: 'settled-late' }, 20) // 先超时敲定为 deny
  const late = resolveApproval('settled-late', 'allow', '用户事后才点的允许')
  unsubscribe()
  assert.equal(late, false, '迟到的决定必须被拒绝写入——waiter 早没了')
  assert.equal(seen.length, 1, '只应该广播一次（超时那次），迟到的 resolve 不该再广播一次')
  assert.deepEqual(seen[0], { approvalId: 'settled-late', decision: 'deny' }, '唯一一次广播的必须是真相：deny')
})

test('resolveApproval 命中不存在的 approvalId 不广播', () => {
  const seen: unknown[] = []
  const unsubscribe = onApprovalSettled((id, d) => seen.push({ id, d }))
  resolveApproval('压根没有这个id', 'allow', '')
  unsubscribe()
  assert.equal(seen.length, 0)
})

test('onApprovalSettled 返回的取消订阅函数生效后不再收到通知', async () => {
  const seen: unknown[] = []
  const unsubscribe = onApprovalSettled((id, d) => seen.push({ id, d }))
  unsubscribe()
  const pending = waitForApproval({ tool_use_id: 'settled-unsub' }, 5_000)
  resolveApproval('settled-unsub', 'allow', '')
  await pending
  assert.equal(seen.length, 0, '取消订阅之后不该再收到')
})

test('多个订阅者都能收到同一次敲定的广播', async () => {
  const a: unknown[] = []
  const b: unknown[] = []
  const unsubA = onApprovalSettled((id, d) => a.push({ id, d }))
  const unsubB = onApprovalSettled((id, d) => b.push({ id, d }))
  const pending = waitForApproval({ tool_use_id: 'settled-multi' }, 5_000)
  resolveApproval('settled-multi', 'deny', '')
  await pending
  unsubA()
  unsubB()
  assert.equal(a.length, 1)
  assert.equal(b.length, 1)
})
