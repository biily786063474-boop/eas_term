import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  IDLE_TIMEOUT_MS,
  shouldReap,
  planSend,
  applyParamChange,
  type SessionRecord
} from './sessionState.ts'

const base = (over: Partial<SessionRecord> = {}): SessionRecord => ({
  id: 's1',
  cli: 'claude',
  cwd: '/WORK/proj',
  alive: true,
  lastActiveAt: 1_000_000,
  startedAt: 1_000_000,
  model: 'sonnet',
  effort: 'medium',
  ...over
})

test('空闲回收阈值是 15 分钟', () => {
  assert.equal(IDLE_TIMEOUT_MS, 15 * 60 * 1000)
})

test('刚活动过的会话不回收', () => {
  const s = base()
  assert.equal(shouldReap(s, s.lastActiveAt + 60_000), false)
})

test('超过 15 分钟没动静的活会话要回收', () => {
  const s = base()
  assert.equal(shouldReap(s, s.lastActiveAt + IDLE_TIMEOUT_MS + 1), true)
})

test('已经死了的会话不重复回收', () => {
  const s = base({ alive: false })
  assert.equal(shouldReap(s, s.lastActiveAt + IDLE_TIMEOUT_MS + 1), false)
})

test('改模型只记为待生效，不动当前会话', () => {
  const s = applyParamChange(base(), { model: 'opus' })
  assert.equal(s.model, 'sonnet', '当前会话的模型不能当场改——那会截断正在跑的任务')
  assert.equal(s.pending?.model, 'opus')
})

test('有待生效参数时，下次发送要重启并 resume', () => {
  const s = applyParamChange(base({ resumeId: 'sess-abc' }), { effort: 'high' })
  const plan = planSend(s, 2_000_000)
  assert.equal(plan.action, 'restart')
  assert.equal(plan.opts.effort, 'high', '重启要用新参数')
  assert.equal(plan.opts.resumeId, 'sess-abc', '重启必须接上原来的上下文')
})

test('没有待生效参数、进程还活着 → 直接发送，不重启', () => {
  const plan = planSend(base(), 1_000_100)
  assert.equal(plan.action, 'send')
})

test('进程已被回收 → 即使没改参数也要重启并 resume', () => {
  const s = base({ alive: false, resumeId: 'sess-abc' })
  const plan = planSend(s, 2_000_000)
  assert.equal(plan.action, 'restart')
  assert.equal(plan.opts.resumeId, 'sess-abc')
})

test('从没起过的会话（无 resumeId）重启时不带 resume 参数', () => {
  const s = base({ alive: false, resumeId: undefined })
  const plan = planSend(s, 2_000_000)
  assert.equal(plan.action, 'restart')
  assert.equal(plan.opts.resumeId, undefined)
})

// ---- 以下是简报测试之外、覆盖我自己实现分支的补充断言（见任务要求：
// 简报的测试若没盖到实现的某个字段/分支，实现者要自己补） ----

test('[补充] 刚好 15 分钟整——未超过阈值，不回收（锁定"超过"是严格大于）', () => {
  const s = base()
  assert.equal(
    shouldReap(s, s.lastActiveAt + IDLE_TIMEOUT_MS),
    false,
    '"超过 15 分钟"应为严格大于，卡在整 15 分钟不该回收'
  )
})

test('[补充] applyParamChange 连续两次改不同字段——待生效参数要合并，不能互相覆盖丢失', () => {
  const s1 = applyParamChange(base(), { model: 'opus' })
  const s2 = applyParamChange(s1, { effort: 'high' })
  assert.equal(s2.pending?.model, 'opus', '先改的 model 不能被后改的 effort 冲掉')
  assert.equal(s2.pending?.effort, 'high')
})

test('[补充] applyParamChange 不改动 model/effort 之外的字段', () => {
  const before = base({ resumeId: 'sess-xyz', alive: true, lastActiveAt: 42 })
  const after = applyParamChange(before, { model: 'opus' })
  assert.equal(after.id, before.id)
  assert.equal(after.cli, before.cli)
  assert.equal(after.cwd, before.cwd)
  assert.equal(after.alive, before.alive)
  assert.equal(after.lastActiveAt, before.lastActiveAt)
  assert.equal(after.resumeId, before.resumeId)
})

test('[补充] 重启时，opts 里未被 patch 的字段保留当前值，不会因为只改了 effort 就丢了 model', () => {
  const s = applyParamChange(base({ resumeId: 'sess-abc' }), { effort: 'high' })
  const plan = planSend(s, 2_000_000)
  assert.equal(plan.action, 'restart')
  assert.equal(plan.opts.model, 'sonnet', 'model 没被 patch，重启也不该丢')
  assert.equal(plan.opts.cwd, s.cwd, 'restart 的 opts 必须带上正确的 cwd')
})

test('[补充] 直接 send 时，opts 也要如实反映当前会话参数（不是占位空值）', () => {
  const s = base({ resumeId: 'sess-abc' })
  const plan = planSend(s, 1_000_100)
  assert.equal(plan.action, 'send')
  assert.equal(plan.opts.cwd, s.cwd)
  assert.equal(plan.opts.model, 'sonnet')
  assert.equal(plan.opts.effort, 'medium')
  assert.equal(plan.opts.resumeId, 'sess-abc')
})

// ---- 审查回来后补的两条：pending.model 通道此前完全没有测试保护
// （原测试 6 只 patch 了 effort、只断言 opts.effort；对称的 model 方向没人验证过
// 「新 patch 值真的生效」，只验证过「未被 patch 的字段不丢」）----

test('[补充/审查后] 待生效的是 model 时，重启要用新 model——镜像测试 6 对 effort 的验证方式，换成 model 通道', () => {
  const s = applyParamChange(base({ resumeId: 'sess-abc' }), { model: 'opus' })
  const plan = planSend(s, 2_000_000)
  assert.equal(plan.action, 'restart')
  assert.equal(plan.opts.model, 'opus', '重启要用新 model——pending.model 必须真的生效，不能被忽略')
  assert.equal(plan.opts.resumeId, 'sess-abc', '重启必须接上原来的上下文')
})

test('[补充/审查后] 改 effort 同样只记为待生效，不动当前 effort——镜像「改模型只记为待生效」那条，换成 effort 通道', () => {
  const s = applyParamChange(base(), { effort: 'high' })
  assert.equal(s.effort, 'medium', '当前会话的 effort 不能当场改——和 model 通道一个道理，同样不能提前生效')
  assert.equal(s.pending?.effort, 'high')
})

// ---- Task 8 补：sandbox 字段（sessionState.ts 原来没有，session.ts 接入时发现的缺口——
// Codex 的 exec 每条消息都会触发 restart，effectiveOpts 若不带上 sandbox，
// 每次 restart 都会静默退回 buildArgs 的默认值，用户选的 read-only 形同虚设） ----

test('[Task 8 补] restart 时 opts 带上 sandbox——Codex 的每条消息都会走 restart，丢了这个字段等于沙箱选择形同虚设', () => {
  const s = base({ cli: 'codex', sandbox: 'read-only', alive: false, resumeId: 'thread-1' })
  const plan = planSend(s, 2_000_000)
  assert.equal(plan.action, 'restart')
  assert.equal(plan.opts.sandbox, 'read-only')
})

test('[Task 8 补] 直接 send 时 opts 也如实带上 sandbox（不是占位空值）', () => {
  const s = base({ sandbox: 'workspace-write' })
  const plan = planSend(s, 1_000_100)
  assert.equal(plan.action, 'send')
  assert.equal(plan.opts.sandbox, 'workspace-write')
})

test('[Task 8 补] 没设过 sandbox 的会话（比如 Claude）——opts.sandbox 是 undefined，不是编造的默认值', () => {
  const s = base({ alive: false, resumeId: 'sess-abc' })
  const plan = planSend(s, 2_000_000)
  assert.equal(plan.opts.sandbox, undefined)
})

// ---- 补：skipApprovalHook 字段（用户在 B 的询问卡片上选"这次不装"）——跟 sandbox
// 同一个理由必须原样镜像那三条测试：Codex 式的"每条消息都 restart"场景下，这个字段
// 若不随 SessionRecord 一起被 effectiveOpts 带上，用户拒绝过一次之后，下一条消息触发
// 的 restart 会悄悄把 hook 又装回去——那就是"假装拒绝生效"，回到本轮要修的那个问题。----

test('[补] 用户选了"不装"→ restart 时 opts.skipApprovalHook 必须原样带上', () => {
  const s = base({ alive: false, resumeId: 'sess-abc', skipApprovalHook: true })
  const plan = planSend(s, 2_000_000)
  assert.equal(plan.action, 'restart')
  assert.equal(plan.opts.skipApprovalHook, true)
})

test('[补] 直接 send（不重启）时 opts 也如实带上 skipApprovalHook，不是重启专属字段', () => {
  const s = base({ skipApprovalHook: true })
  const plan = planSend(s, 1_000_100)
  assert.equal(plan.action, 'send')
  assert.equal(plan.opts.skipApprovalHook, true)
})

test('[补] 没设过 skipApprovalHook 的会话（默认路径，比如已经同意装的）——opts.skipApprovalHook 是 undefined，不是编造成 false', () => {
  const s = base({ alive: false, resumeId: 'sess-abc' })
  const plan = planSend(s, 2_000_000)
  assert.equal(plan.opts.skipApprovalHook, undefined)
})

test('[补] 改 model/effort 触发的 restart（决定 3 那条路径）同样要带上 skipApprovalHook——拒绝过一次之后，中途换模型不能让 hook 又悄悄装回去', () => {
  const s = applyParamChange(base({ resumeId: 'sess-abc', skipApprovalHook: true }), { model: 'opus' })
  const plan = planSend(s, 2_000_000)
  assert.equal(plan.action, 'restart')
  assert.equal(plan.opts.skipApprovalHook, true, '不能因为这次 restart 是"改模型"触发的，就把用户拒绝过的选择弄丢')
})

// ── 团队 agent 交活之后走更短的回收窗口 ───────────────────────────────

test('团队 agent 交活后 3 分钟就回收，不用等 15 分钟', () => {
  const s = base({ owner: 'team', busy: false, lastActiveAt: 0 })
  assert.equal(shouldReap(s, 3 * 60 * 1000 + 1), true, '过了 3 分钟该回收')
  assert.equal(shouldReap(s, 3 * 60 * 1000), false, '刚好卡在阈值上不算（严格大于）')
})

test('团队 agent 还在跑就不能提前回收', () => {
  // lastActiveAt 一直在续期，正常不会触发；但万一它真卡住不出声，
  // 那 15 分钟的窗口是留给人去面板上看一眼的，不该被短阈值抢先杀掉
  const busy = base({ owner: 'team', busy: true, lastActiveAt: 0 })
  assert.equal(shouldReap(busy, 4 * 60 * 1000), false)
  assert.equal(shouldReap(busy, 15 * 60 * 1000 + 1), true, '超过 15 分钟仍然回收')
})

test('团队 agent 一轮都没跑过（busy 未定）不走短阈值', () => {
  const fresh = base({ owner: 'team', lastActiveAt: 0 })
  assert.equal(shouldReap(fresh, 4 * 60 * 1000), false, '会话刚建起来，可能正等第一条消息')
})

test('你自己开的对话不受影响，仍然是 15 分钟', () => {
  const mine = base({ busy: false, lastActiveAt: 0 })
  assert.equal(shouldReap(mine, 4 * 60 * 1000), false, '走开一会儿不该被杀')
  assert.equal(shouldReap(mine, 15 * 60 * 1000 + 1), true)
})
