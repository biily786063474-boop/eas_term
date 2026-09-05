import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  IDLE_TIMEOUT_MS,
  TEAM_IDLE_TIMEOUT_MS,
  BUSY_IDLE_TIMEOUT_MS,
  shouldReap,
  planRecovery,
  RECOVERY_DELAYS_MS,
  planSend,
  applyParamChange,
  type SessionRecord
} from './sessionState.ts'
import type { RoleBounds } from '../../shared/roleBinding.ts'

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

test('空闲回收阈值是 2 小时', () => {
  // 2026-08-20 从 15 分钟调上来（用户要求）。开着对话离开一会儿是常态，
  // 回来发现进程没了、下一条消息要等冷启动，省的那点内存不值这个打断。
  assert.equal(IDLE_TIMEOUT_MS, 2 * 60 * 60 * 1000)
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

// ---- 补：roleBounds / knownMcpServers 字段——跟 sandbox / skipApprovalHook 同一个理由
// 必须原样存在 SessionRecord 上并被 effectiveOpts 带过 restart：Codex 的 exec 每条消息
// 都会触发 restart，这两个字段若不随着走，角色的能力边界（caps）与 MCP 白名单就会从
// 第二条消息起悄悄消失——界面上角色卡片看起来还选着，实际护栏已经不在了。 ----

test('[补] restart 时 opts 带上 roleBounds——丢了等于角色的 caps 从第二条消息起静默失效', () => {
  const bounds: RoleBounds = { caps: { write: false } }
  const s = base({ alive: false, resumeId: 'sess-abc', roleBounds: bounds })
  const plan = planSend(s, 2_000_000)
  assert.equal(plan.action, 'restart')
  assert.deepEqual(plan.opts.roleBounds, bounds)
})

test('[补] restart 时 opts 带上 knownMcpServers——丢了会让 Codex 的 MCP 白名单从第二条消息起静默消失', () => {
  const s = base({ alive: false, resumeId: 'sess-abc', knownMcpServers: ['eas-term', 'bizone-canvas'] })
  const plan = planSend(s, 2_000_000)
  assert.equal(plan.action, 'restart')
  assert.deepEqual(plan.opts.knownMcpServers, ['eas-term', 'bizone-canvas'])
})

// ── 团队 agent 交活之后走更短的回收窗口 ───────────────────────────────

test('团队 agent **交活之后** 3 分钟就回收', () => {
  // 第三个参数 = 交活了。没交活的走另一条（见下一条测试）
  const s = base({ owner: 'team', busy: false, lastActiveAt: 0 })
  assert.equal(shouldReap(s, 3 * 60 * 1000 + 1, true), true, '过了 3 分钟该回收')
  assert.equal(shouldReap(s, 3 * 60 * 1000, true), false, '刚好卡在阈值上不算（严格大于）')
})

test('**没交活就停下的团队 agent 不走 3 分钟那档**', () => {
  // 用户 2026-08-20：「三次派发，三次死在同一处：agent 还在跑，承载它的会话进程
  // 就没了……它从来没跑到写文件那一步」。成因就是这里：agent 说完第一轮
  // （「我先看看代码结构」）busy 就落回 false，而判据只看 busy 不看有没有产出，
  // 3 分钟后进程被杀，再也没人能 team_send 推它继续。
  const s = base({ owner: 'team', busy: false, lastActiveAt: 0 })
  assert.equal(shouldReap(s, 3 * 60 * 1000 + 1, false), false, '没交活不该 3 分钟就杀')
  assert.equal(shouldReap(s, 10 * 60 * 1000, false), false, '十分钟也不该')
  assert.equal(shouldReap(s, IDLE_TIMEOUT_MS + 1, false), true, '最终仍有兜底')
})

test('团队 agent 还在跑就不能提前回收', () => {
  // 这条原来断言的是「超过 15 分钟仍然回收」，理由写着「万一它真卡住不出声，
  // 15 分钟的窗口是留给人去面板上看一眼的」。
  //
  // **2026-08-20 改成 4 小时**：同一个论证反过来也成立 —— 一个正常跑长任务的
  // agent（自己在等子 agent，或者在跑一条长命令）stdout 同样是静默的，
  // 15 分钟会把它杀在半路，**整趟工作不可逆地没了**。
  // 卡住的那种留着只是占资源，而且面板上写着「可能卡住」、随手就能停。
  // 两边的代价不对等，所以判据偏向不杀。
  const busy = base({ owner: 'team', busy: true, lastActiveAt: 0 })
  assert.equal(shouldReap(busy, 4 * 60 * 1000), false)
  assert.equal(shouldReap(busy, IDLE_TIMEOUT_MS + 1), false, '15 分钟不再回收正在跑的')
  assert.equal(shouldReap(busy, BUSY_IDLE_TIMEOUT_MS + 1), true, '4 小时仍然兜底')
})

test('团队 agent 一轮都没跑过（busy 未定）不走短阈值', () => {
  const fresh = base({ owner: 'team', lastActiveAt: 0 })
  assert.equal(shouldReap(fresh, 4 * 60 * 1000), false, '会话刚建起来，可能正等第一条消息')
})

test('你自己开的对话不走团队那条短阈值，吃 2 小时那档', () => {
  // 团队 agent 交完活 3 分钟就回收，普通对话不该跟着走那条。
  // 2026-08-20 起这一档从 15 分钟提到 2 小时（用户要求）。
  const mine = base({ busy: false, lastActiveAt: 0 })
  assert.equal(shouldReap(mine, 4 * 60 * 1000), false, '走开一会儿不该被杀')
  assert.equal(shouldReap(mine, 15 * 60 * 1000 + 1), false, '开个会回来会话还在')
  assert.equal(shouldReap(mine, IDLE_TIMEOUT_MS + 1), true)
})


// —— 回收阈值三档（2026-08-20：ultracode 派子 agent 时被当成空闲杀掉）——

test('这一轮还在跑 → 走 4 小时，15 分钟不动它', () => {
  // 主 agent 派了子 agent、自己在等的那段时间 stdout 完全静默，
  // 按 15 分钟算会把一个正常干活的会话杀在半路
  const s = base({ busy: true, lastActiveAt: 0 })
  assert.equal(shouldReap(s, IDLE_TIMEOUT_MS + 1000), false)
  assert.equal(shouldReap(s, BUSY_IDLE_TIMEOUT_MS + 1000), true)
})

test('团队 agent 跑完这轮**且交了活** → 3 分钟', () => {
  const s = base({ owner: 'team', busy: false, lastActiveAt: 0 })
  assert.equal(shouldReap(s, TEAM_IDLE_TIMEOUT_MS + 1000, true), true)
})

test('团队 agent 还在跑 → 同样吃 4 小时那档，不被短阈值抢先杀掉', () => {
  const s = base({ owner: 'team', busy: true, lastActiveAt: 0 })
  assert.equal(shouldReap(s, TEAM_IDLE_TIMEOUT_MS + 1000), false)
  assert.equal(shouldReap(s, IDLE_TIMEOUT_MS + 1000), false)
})

test('一轮都没跑过的新会话 → 15 分钟', () => {
  const s = base({ busy: undefined, lastActiveAt: 0 })
  assert.equal(shouldReap(s, IDLE_TIMEOUT_MS + 1000), true)
})

test('进程已经没了就不用回收', () => {
  assert.equal(shouldReap(base({ alive: false, busy: true, lastActiveAt: 0 }), 1e12), false)
})


// —— 自动恢复（网络抖断的子 agent 自己接着干，不打扰用户）——

const NOW2 = 1_700_000_000_000
const broken = (over: Partial<SessionRecord> = {}): SessionRecord =>
  base({ owner: 'team', alive: false, ended: 'interrupted', resumeId: 'r1', ...over })

test('被打断的团队 agent：先等一段退避，到点才重启', () => {
  const s = broken()
  const p1 = planRecovery(s, NOW2)
  assert.deepEqual(p1, { act: 'wait', at: NOW2 + RECOVERY_DELAYS_MS[0] })
  // 到点了
  const armed = { ...s, retryAt: NOW2 }
  assert.deepEqual(planRecovery(armed, NOW2), { act: 'go', attempt: 1 })
})

test('退避一次比一次长 —— 断着网连撞几次，每次都是一整个上下文的钱', () => {
  for (let i = 0; i < RECOVERY_DELAYS_MS.length; i++) {
    const p = planRecovery(broken({ retries: i }), NOW2)
    assert.deepEqual(p, { act: 'wait', at: NOW2 + RECOVERY_DELAYS_MS[i] })
  }
  assert.ok(RECOVERY_DELAYS_MS[1] > RECOVERY_DELAYS_MS[0])
  assert.ok(RECOVERY_DELAYS_MS[2] > RECOVERY_DELAYS_MS[1])
})

test('试到头就交给人，不无限重试', () => {
  assert.deepEqual(planRecovery(broken({ retries: RECOVERY_DELAYS_MS.length }), NOW2), { act: 'give-up' })
})

test('**没有 resumeId 不恢复** —— 那样重启的是个什么都不记得的新会话，等于重花一份钱做一遍', () => {
  assert.equal(planRecovery(broken({ resumeId: undefined }), NOW2), null)
})

test('用户自己的对话不自动重启 —— 要不要接着聊是他的事', () => {
  assert.equal(planRecovery(broken({ owner: undefined }), NOW2), null)
})

test('正常跑完退出的不需要恢复', () => {
  assert.equal(planRecovery(broken({ ended: 'ok' }), NOW2), null)
})

test('还活着的不碰', () => {
  assert.equal(planRecovery(broken({ alive: true }), NOW2), null)
})

// —— 后台任务（ultracode / workflow）——

test('派了后台任务、这一轮已结束 → 走 4 小时那档，不按空闲算', () => {
  // 2026-08-20 开发版实测：起一个最小 ultracode，主 agent 调完 workflow
  // 那一轮当场结束（busy=false），然后一路静默（T+120s 已经静默 100s）。
  // 按 15 分钟的老阈值 900 秒必死，而它明明在等后台的 agent 干活 ——
  // 用户报的「三次派发，三次死在同一处」就是这么来的。
  const s = base({ busy: false, bgTask: true, lastActiveAt: 0 })
  assert.equal(shouldReap(s, IDLE_TIMEOUT_MS + 1), false, '2 小时也不该杀正在等后台任务的')
  assert.equal(shouldReap(s, BUSY_IDLE_TIMEOUT_MS + 1), true, '4 小时仍有兜底')
})

test('没派后台任务的普通空闲照旧', () => {
  const s = base({ busy: false, bgTask: false, lastActiveAt: 0 })
  assert.equal(shouldReap(s, IDLE_TIMEOUT_MS + 1), true)
})
