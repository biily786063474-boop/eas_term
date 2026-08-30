import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createChatReducer, visibleExecs, MAX_NOTICES } from './reduce.ts'
import type { ChatEvent } from '../../../../shared/agentChat.ts'

/** 把一串事件喂进去，返回最终视图 */
function run(events: ChatEvent[]) {
  const r = createChatReducer()
  for (const e of events) r.push(e)
  return r.view()
}

const ready: ChatEvent = { k: 'session.ready', sessionId: 's1', model: 'sonnet', cwd: '/WORK/proj' }

// ============================================================
// 以下到分隔线为止，逐字来自 task-1-brief.md —— 不许改动断言内容。
// ============================================================

test('模型文字整段到达，形成一个 assistant 轮次', () => {
  const v = run([ready, { k: 'text.done', text: '好的，我看一下' }])
  assert.equal(v.turns.length, 1)
  assert.equal(v.turns[0].role, 'assistant')
  assert.equal(v.turns[0].text, '好的，我看一下')
})

test('exec 挂在它之前那段文字下面', () => {
  const v = run([
    ready,
    { k: 'text.done', text: '我来改一下' },
    { k: 'exec.start', execId: 'e1', label: '编辑 a.ts', detail: '{}' },
    { k: 'exec.done', execId: 'e1', ok: true, output: 'done' }
  ])
  assert.equal(v.turns.length, 1)
  assert.equal(v.turns[0].execs.length, 1)
  assert.equal(v.turns[0].execs[0].state, 'ok')
})

test('exec.start 后未 done 的状态是 running', () => {
  const v = run([ready, { k: 'exec.start', execId: 'e1', label: '运行 npm test', detail: '{}' }])
  assert.equal(v.turns[0].execs[0].state, 'running')
  assert.equal(v.busy, true, '有未完成的执行项时应处于忙碌态')
})

test('exec.done{ok:false} 记为 failed 并带上输出', () => {
  const v = run([
    ready,
    { k: 'exec.start', execId: 'e1', label: '运行 ls', detail: '{}' },
    { k: 'exec.done', execId: 'e1', ok: false, output: 'No such file' }
  ])
  assert.equal(v.turns[0].execs[0].state, 'failed')
  assert.equal(v.turns[0].execs[0].output, 'No such file')
})

test('三行窗口：折叠时只留最近三条', () => {
  const execs = ['a', 'b', 'c', 'd', 'e'].map((id) => ({
    execId: id, label: 'x', detail: '', state: 'ok' as const
  }))
  const shown = visibleExecs(execs, false)
  assert.equal(shown.length, 3)
  assert.deepEqual(shown.map((e) => e.execId), ['c', 'd', 'e'])
})

test('三行窗口：失败项常驻，不会被滚出去', () => {
  // 这条是硬要求：实测过模型在操作被拒后仍会说「已创建完成」，
  // 失败被埋掉的话，用户看到的就是一句谎话加一片安静。
  const execs = [
    { execId: 'bad', label: 'x', detail: '', state: 'failed' as const, output: 'boom' },
    ...['b', 'c', 'd', 'e'].map((id) => ({ execId: id, label: 'x', detail: '', state: 'ok' as const }))
  ]
  const shown = visibleExecs(execs, false)
  assert.ok(shown.some((e) => e.execId === 'bad'), '失败项必须仍然可见')
})

test('三行窗口：展开时全部显示', () => {
  const execs = ['a', 'b', 'c', 'd', 'e'].map((id) => ({
    execId: id, label: 'x', detail: '', state: 'ok' as const
  }))
  assert.equal(visibleExecs(execs, true).length, 5)
})

test('approval.request 进 pending，resolved 后清空', () => {
  const r = createChatReducer()
  r.push(ready)
  r.push({ k: 'approval.request', approvalId: 'a1', kind: 'patch', title: '修改 a.ts', detail: '{}', cwd: '/WORK/proj' })
  assert.equal(r.view().pending?.approvalId, 'a1')
  r.push({ k: 'approval.resolved', approvalId: 'a1', decision: 'allow' })
  assert.equal(r.view().pending, null)
})

test('turn.done 带上 usage 与花费', () => {
  const v = run([
    ready,
    { k: 'turn.done', usage: { inputTokens: 10, outputTokens: 20, cachedInputTokens: 5 }, costUsd: 0.01 }
  ])
  assert.equal(v.usage?.outputTokens, 20)
  assert.equal(v.costUsd, 0.01)
  assert.equal(v.busy, false, 'turn.done 之后不再忙碌')
})

test('非致命 error 进 notices，不丢弃', () => {
  // Ruling 14 的全部说服力压在「用户会看见」上——归约器丢掉它，界面就没得显示
  const v = run([ready, { k: 'error', message: '本次会话未能开启审批保护', fatal: false }])
  assert.equal(v.notices.length, 1)
  assert.equal(v.notices[0].fatal, false)
  assert.ok(v.notices[0].text.includes('审批'))
})

test('致命 error 也进 notices，并标记 fatal', () => {
  const v = run([ready, { k: 'error', message: '进程启动失败', fatal: true }])
  assert.equal(v.notices[0].fatal, true)
})

test('text.delta 不会到达，但收到也不能崩', () => {
  // 目前零生产者；万一将来 A 层实现了流式，这里至少不该抛
  assert.doesNotThrow(() => run([ready, { k: 'text.delta', text: '半' } as ChatEvent]))
})

test('未知事件类型被忽略，不抛', () => {
  assert.doesNotThrow(() => run([ready, { k: '没见过' } as unknown as ChatEvent]))
})

// ============================================================
// 以下是补充断言。题面给的用例只挑了部分字段——比如「exec 挂在它之前那段文字下面」
// 那条只查了 state==='ok'，从没断言过 execId/label/detail/output 有没有原样带到；
// 「approval.request 进 pending」只查了 approvalId，kind/title/detail/cwd 没人锁；
// busy 的定义在 Step 3 里明写了两支「有 running 项，或收到过 exec.start 但还没
// turn.done」，但题面给的用例只覆盖了第一支单独成立、和两支都不成立的情况，
// 第二支单独成立（exec 已经全部 done，但 turn.done 还没来）从没被测过。
// 折叠窗口那条「失败项常驻」题面只用 .some() 查了 bad 在不在，一个「只要有失败项
// 就把全部都吐出来」的实现也能骗过去——这里补一条 deepEqual 精确锁集合与顺序。
// 按纪律逐个字段自问「改成一个固定错值，题面测试会不会失败」，不会的都在这里补上
// （做法沿用 task-0-report.md 记录的同一惯例）。
// ============================================================

test('[补充] exec.start 在还没有任何文字轮次时，会先造一个空文本的 assistant 轮次', () => {
  // Step 3 原话：「若还没有轮次，先造一个空文本的」——题面给的「running」用例
  // 走的正是这条分支，却从没断言过 turns.length / role / text，只查了 execs[0].state。
  const v = run([ready, { k: 'exec.start', execId: 'e1', label: '运行 npm test', detail: '{}' }])
  assert.equal(v.turns.length, 1)
  assert.equal(v.turns[0].role, 'assistant')
  assert.equal(v.turns[0].text, '')
})

test('[补充] exec 项的 execId / label / detail 原样带出，不是题面例句里那几个固定值的巧合', () => {
  const v = run([
    ready,
    { k: 'text.done', text: '开始' },
    { k: 'exec.start', execId: 'e42', label: '运行 pytest', detail: '{"cmd":"pytest -k foo"}' }
  ])
  const item = v.turns[0].execs[0]
  assert.equal(item.execId, 'e42')
  assert.equal(item.label, '运行 pytest')
  assert.equal(item.detail, '{"cmd":"pytest -k foo"}')
})

test('[补充] running 状态的执行项没有 output 字段（不能提前补一个占位值）', () => {
  const v = run([ready, { k: 'exec.start', execId: 'e1', label: 'x', detail: '' }])
  assert.equal(v.turns[0].execs[0].output, undefined)
})

test('[补充] exec.done{ok:true} 的 output 也要带到 ExecItem 上，不是只有失败才搬运', () => {
  const v = run([
    ready,
    { k: 'exec.start', execId: 'e1', label: 'x', detail: '' },
    { k: 'exec.done', execId: 'e1', ok: true, output: '共处理 3 个文件' }
  ])
  assert.equal(v.turns[0].execs[0].output, '共处理 3 个文件')
})

test('[补充] exec.done 对一个不存在的 execId 直接忽略：不抛，也不影响其他项（Step 3 明写但题面零覆盖）', () => {
  const v = run([
    ready,
    { k: 'exec.start', execId: 'e1', label: 'x', detail: '' },
    { k: 'exec.done', execId: 'ghost', ok: true, output: 'nope' }
  ])
  assert.equal(v.turns[0].execs.length, 1)
  assert.equal(v.turns[0].execs[0].execId, 'e1')
  assert.equal(v.turns[0].execs[0].state, 'running', '不存在的 execId 不该影响 e1 的状态')
})

test('[补充] 两个 exec 各自独立更新状态，按 execId 匹配而不是按下标', () => {
  const v = run([
    ready,
    { k: 'exec.start', execId: 'e1', label: 'A', detail: '' },
    { k: 'exec.start', execId: 'e2', label: 'B', detail: '' },
    { k: 'exec.done', execId: 'e1', ok: true, output: 'A done' }
  ])
  const execs = v.turns[0].execs
  assert.equal(execs.length, 2)
  assert.equal(execs.find((e) => e.execId === 'e1')?.state, 'ok')
  assert.equal(execs.find((e) => e.execId === 'e1')?.output, 'A done')
  assert.equal(execs.find((e) => e.execId === 'e2')?.state, 'running', 'e2 不该被 e1 的 done 连带改掉')
})

test('[补充] 有两段文字后，exec 挂在最新（最后）一个 assistant 轮次上，不是第一个', () => {
  const v = run([
    ready,
    { k: 'text.done', text: '第一段' },
    { k: 'text.done', text: '第二段' },
    { k: 'exec.start', execId: 'e1', label: 'x', detail: '' }
  ])
  assert.equal(v.turns.length, 2)
  assert.equal(v.turns[0].execs.length, 0)
  assert.equal(v.turns[1].execs.length, 1)
  assert.equal(v.turns[1].text, '第二段')
})

test('[补充] approval.request 的 kind / title / detail / cwd 原样带到 pending 上，不是只有 approvalId', () => {
  const r = createChatReducer()
  r.push(ready)
  r.push({
    k: 'approval.request',
    approvalId: 'a1',
    kind: 'exec',
    title: '运行 rm -rf',
    detail: '{"cmd":"rm -rf tmp"}',
    cwd: '/WORK/proj'
  })
  const p = r.view().pending
  assert.equal(p?.kind, 'exec')
  assert.equal(p?.title, '运行 rm -rf')
  assert.equal(p?.detail, '{"cmd":"rm -rf tmp"}')
  assert.equal(p?.cwd, '/WORK/proj')
})

test('[补充] approval.resolved 无论 decision 是 allow 还是 deny 都要清空 pending', () => {
  // 题面只测过 allow 那一支；如果实现悄悄写成「只有 allow 才清」，
  // 被拒绝的审批弹窗会卡死在界面上，用户点了「拒绝」却什么都没发生。
  const r = createChatReducer()
  r.push(ready)
  r.push({ k: 'approval.request', approvalId: 'a1', kind: 'tool', title: 't', detail: '', cwd: '/x' })
  r.push({ k: 'approval.resolved', approvalId: 'a1', decision: 'deny' })
  assert.equal(r.view().pending, null)
})

test('[补充] turn.done 的 usage 三个字段原样带出，不是只有 outputTokens 那一个被搬运', () => {
  const v = run([
    ready,
    { k: 'turn.done', usage: { inputTokens: 10, outputTokens: 20, cachedInputTokens: 5 }, costUsd: 0.01 }
  ])
  assert.equal(v.usage?.inputTokens, 10)
  assert.equal(v.usage?.outputTokens, 20)
  assert.equal(v.usage?.cachedInputTokens, 5)
})

test('[补充] 第二次 turn.done 没带 costUsd 时，沿用上一次的值，不覆写成 undefined', () => {
  // 语义依据：claudeEvents.ts 里 costUsd 取自 Claude 的 total_cost_usd——名字就是
  // total，是累计花费，不会倒退。这一轮没报出这个字段不代表花费清零，覆写成
  // undefined 会让界面上的花费从有变没有，看起来像统计坏了，那是在显示假信息。
  // 审查用「覆写成 undefined」的语义跑过一遍这组测试：36 条全绿——因为此前两条
  // 涉及 costUsd 的用例都只有一次 turn.done、且都用同一个值 0.01，从没测过「第二次
  // 不带」这个场景，唯一断言 costUsd===undefined 的用例是初始态，根本没经过
  // turn.done 分支。这条就是补那个真空档的。
  const r = createChatReducer()
  r.push(ready)
  r.push({ k: 'turn.done', usage: { inputTokens: 1, outputTokens: 1 }, costUsd: 0.24 })
  r.push({ k: 'turn.done', usage: { inputTokens: 2, outputTokens: 2 } })
  assert.equal(r.view().costUsd, 0.24, '第二轮没带 costUsd，视图应保留第一轮已知的累计花费')
})

test('[补充] 第二次 turn.done 带了新的 costUsd 时要更新成新值，不是「锁死第一次收到的值」', () => {
  // 只测「省略时沿用」还不够——一个把 costUsd 焊死成第一次收到的值、之后永远
  // 忽略新值的实现，也能让上一条测试通过。这里反过来锁住「有新值就要用新值」。
  const r = createChatReducer()
  r.push(ready)
  r.push({ k: 'turn.done', usage: { inputTokens: 1, outputTokens: 1 }, costUsd: 0.24 })
  r.push({ k: 'turn.done', usage: { inputTokens: 2, outputTokens: 2 }, costUsd: 0.31 })
  assert.equal(r.view().costUsd, 0.31, '带了新值就该用新值，累计花费涨了要反映出来')
})

test('[补充] exec 已经全部 done，但 turn.done 还没来 → 仍然 busy（Step 3 busy 定义的第二支，题面用例零覆盖）', () => {
  const v = run([
    ready,
    { k: 'exec.start', execId: 'e1', label: 'x', detail: '' },
    { k: 'exec.done', execId: 'e1', ok: true, output: 'ok' }
  ])
  assert.equal(v.busy, true, '没有 running 项了，但还没收到 turn.done，agent 可能还要继续说话或再发起下一步')
})

test('[补充] turn.done 之后又来一次 exec.start 并很快 done → busy 重新变 true，不是「用过一次就失效」的开关', () => {
  const v = run([
    ready,
    { k: 'exec.start', execId: 'e1', label: 'x', detail: '' },
    { k: 'exec.done', execId: 'e1', ok: true, output: 'ok' },
    { k: 'turn.done', usage: { inputTokens: 1, outputTokens: 1 } },
    { k: 'exec.start', execId: 'e2', label: 'y', detail: '' },
    { k: 'exec.done', execId: 'e2', ok: true, output: 'ok' }
  ])
  assert.equal(v.busy, true, 'e2 已经 done、没有 running 项，但还没收到新一轮的 turn.done，仍算 busy')
})

test('[补充] notice.text 与 error.message 完全一致，不是被包了一层前缀或摘要', () => {
  const v = run([ready, { k: 'error', message: '连接已断开', fatal: true }])
  assert.equal(v.notices[0].text, '连接已断开')
})

test('[补充] 连续两条 error 都进 notices、都带独立且非空的 id，不会互相覆盖也不会撞号', () => {
  const v = run([
    ready,
    { k: 'error', message: '第一条', fatal: false },
    { k: 'error', message: '第二条', fatal: true }
  ])
  assert.equal(v.notices.length, 2)
  assert.equal(v.notices[0].text, '第一条')
  assert.equal(v.notices[1].text, '第二条')
  assert.ok(v.notices[0].id, 'id 必须是非空值')
  assert.ok(v.notices[1].id, 'id 必须是非空值')
  assert.notEqual(v.notices[0].id, v.notices[1].id, 'id 不能重复，否则界面列表的 key 会撞')
})

test('[补充] 折叠窗口的返回值精确等于「最近三条 ∪ 全部失败项」，按原顺序——不是「有失败就整批吐出来」', () => {
  const execs = [
    { execId: 'bad', label: 'x', detail: '', state: 'failed' as const, output: 'boom' },
    ...['b', 'c', 'd', 'e'].map((id) => ({ execId: id, label: 'x', detail: '', state: 'ok' as const }))
  ]
  const shown = visibleExecs(execs, false)
  assert.deepEqual(shown.map((e) => e.execId), ['bad', 'c', 'd', 'e'])
})

test('[补充] 失败项恰好已经落在最近三条以内时不会重复出现', () => {
  // 防的是 [...失败项, ...最近三条] 这种简单拼接实现——会把 bad 塞进结果两次
  const execs = [
    { execId: 'a', label: 'x', detail: '', state: 'ok' as const },
    { execId: 'b', label: 'x', detail: '', state: 'ok' as const },
    { execId: 'bad', label: 'x', detail: '', state: 'failed' as const, output: 'boom' }
  ]
  const shown = visibleExecs(execs, false)
  assert.deepEqual(shown.map((e) => e.execId), ['a', 'b', 'bad'])
})

test('[补充] 多个失败项都落在最近三条之外时，要全部保留，不是只留最早或最近一个', () => {
  const execs = [
    { execId: 'bad1', label: 'x', detail: '', state: 'failed' as const, output: 'boom1' },
    { execId: 'bad2', label: 'x', detail: '', state: 'failed' as const, output: 'boom2' },
    { execId: 'c', label: 'x', detail: '', state: 'ok' as const },
    { execId: 'd', label: 'x', detail: '', state: 'ok' as const },
    { execId: 'e', label: 'x', detail: '', state: 'ok' as const }
  ]
  const shown = visibleExecs(execs, false)
  assert.deepEqual(shown.map((e) => e.execId), ['bad1', 'bad2', 'c', 'd', 'e'])
})

test('[补充] 总数不超过三条时，折叠与展开结果相同（边界情况，防止 slice 越界出错）', () => {
  const execs = ['a', 'b'].map((id) => ({ execId: id, label: 'x', detail: '', state: 'ok' as const }))
  assert.deepEqual(visibleExecs(execs, false).map((e) => e.execId), ['a', 'b'])
})

test('[补充] 空数组不抛，折叠和展开都返回空数组', () => {
  assert.deepEqual(visibleExecs([], false), [])
  assert.deepEqual(visibleExecs([], true), [])
})

test('[补充] session.ready 本身不产生任何轮次，也不自己置忙（忙不忙看 turn.start）', () => {
  // 这条断言 2026-08-17 改过两次，记下来免得再绕回去：
  //   原始：busy=false，理由「session.ready 不产生轮次，所以空闲」
  //   一改：busy=true，理由「start() 带着消息一起发，ready 到达时已经在处理了」
  //   二改（现在）：回到 false —— **结论没变，是判据换了地方**。
  // 「在忙」现在由会话层投递消息时推的 turn.start 表达，session.ready 只说明
  // 进程起来了。一改那版拿 ready 当起点是个近似，而且漏掉了普通 send
  //（不产生 session.ready），第二条消息之后就永远不置忙了。
  const v = run([ready])
  assert.deepEqual(v.turns, [])
  assert.equal(v.pending, null)
  assert.equal(v.busy, false)
})

test('**turn.start 之后 busy 为真**（断档的根因：投递到首字之间实测有 4 秒多）', () => {
  assert.equal(run([{ k: 'turn.start' }]).busy, true)
  // 真实序列里 turn.start 先于 session.ready（投递时推，spawn 之后 CLI 才吐 init）
  assert.equal(run([{ k: 'turn.start' }, ready]).busy, true)
})

test('**第二条消息也要置忙** —— 普通 send 不产生 session.ready，这是上一版漏掉的洞', () => {
  const v = run([
    { k: 'turn.start' },
    ready,
    { k: 'text.done', text: '第一轮' },
    { k: 'turn.done', usage: { inputTokens: 1, outputTokens: 1 } },
    // 第二条消息：只有 turn.start，没有新的 session.ready
    { k: 'turn.start' }
  ])
  assert.equal(v.busy, true, '拿 session.ready 当起点的话这里会是 false')
})

test('致命 error 结束这一轮——不然 turn.done 永远不来，界面一直转', () => {
  const v = run([{ k: 'turn.start' }, { k: 'error', message: '进程启动失败', fatal: true }])
  assert.equal(v.busy, false)
})

test('非致命 error 不结束这一轮（那只是条提醒，会话还在跑）', () => {
  const v = run([{ k: 'turn.start' }, { k: 'error', message: '没有审批保护', fatal: false }])
  assert.equal(v.busy, true)
})

test('[补充] 完全没推过事件时的初始视图：不是 usage:{} 或 busy:true 这类看似合理实则错的默认值', () => {
  const v = createChatReducer().view()
  assert.deepEqual(v.turns, [])
  assert.equal(v.pending, null)
  assert.deepEqual(v.notices, [])
  assert.equal(v.usage, null)
  assert.equal(v.costUsd, undefined)
  assert.equal(v.busy, false)
})

test('[补充] thinking 事件（真实存在的 ChatEvent 变体，但 Step 3 没提怎么处理）收到不能崩，也不该产生轮次', () => {
  const v = run([ready, { k: 'thinking', tokens: 128 }])
  assert.deepEqual(v.turns, [])
})

// ── 流式（2026-08-17：text.delta 有生产者了）────────────────────────
// 原来这里锁的是「没有打字机态」。那条决定已经被推翻（用户看着静默的等待期
// 不知道软件在不在干活），但它保护的那个不变量**依然有效**并且更要紧了：
// delta 绝不能追加到一个已经 done 完成的轮次上。

test('text.delta 不追加到已经 text.done 完成的轮次上——那是下一段话，要开新轮次', () => {
  const v = run([
    ready,
    { k: 'text.done', text: '完整的话' },
    { k: 'text.delta', text: '下一段' } as ChatEvent
  ])
  assert.equal(v.turns.length, 2, 'done 之后的 delta 属于新一段，不能续在旧轮次后面')
  assert.equal(v.turns[0].text, '完整的话', '已完成的轮次一个字都不该被改动')
  assert.equal(v.turns[1].text, '下一段')
})

test('text.delta 逐字攒进同一个轮次', () => {
  const v = run([
    ready,
    { k: 'text.delta', text: '你' } as ChatEvent,
    { k: 'text.delta', text: '好' } as ChatEvent,
    { k: 'text.delta', text: '在的。' } as ChatEvent
  ])
  assert.equal(v.turns.length, 1, '一段流式文字只能有一个轮次，不是每个 token 一个')
  assert.equal(v.turns[0].text, '你好在的。')
})

test('**紧跟其后的 text.done 覆盖 delta 攒的那段，不是再加一条**', () => {
  // 这是整个流式实现里最容易错的一条：同一段话 CLI 会给两遍
  //（先 delta 逐字、最后 assistant 事件给完整版）。处理错了，用户看到同一段话出现两次。
  const v = run([
    ready,
    { k: 'text.delta', text: '你' } as ChatEvent,
    { k: 'text.delta', text: '好' } as ChatEvent,
    { k: 'text.done', text: '你好在的。' }
  ])
  assert.equal(v.turns.length, 1, '同一段话不能显示两次')
  assert.equal(v.turns[0].text, '你好在的。', 'done 是权威版本，delta 可能不全')
})

test('流式途中挂上的 exec 不会被随后的 text.done 抹掉', () => {
  // done 覆盖的是 text，execs 得留着——工具调用可能在文字中间就挂到这个轮次上了
  const v = run([
    ready,
    { k: 'text.delta', text: '我看看' } as ChatEvent,
    { k: 'exec.start', execId: 'e1', label: '读取', detail: 'a.ts' },
    { k: 'text.done', text: '我看看 a.ts' }
  ])
  assert.equal(v.turns.length, 1)
  assert.equal(v.turns[0].text, '我看看 a.ts')
  assert.equal(v.turns[0].execs.length, 1, 'exec 被 done 抹掉了')
  assert.equal(v.turns[0].execs[0].execId, 'e1')
})

test('turn.done 之后的 text.done 不去覆盖上一轮的最后一个轮次', () => {
  // 不清 streamingTurn 的话，下一轮的第一句会把上一轮的回答改掉——
  // 表现成「新回答把旧回答吃了」，而且旧内容再也回不来
  const v = run([
    ready,
    { k: 'text.delta', text: '第一轮' } as ChatEvent,
    { k: 'turn.done', usage: { inputTokens: 1, outputTokens: 1 } },
    { k: 'text.done', text: '第二轮' }
  ])
  assert.equal(v.turns.length, 2)
  assert.equal(v.turns[0].text, '第一轮')
  assert.equal(v.turns[1].text, '第二轮')
})

// ============================================================
// 2026-08-17 全分支最终评审 I5：notices 只增不减、无上限、无关闭，而它挂在
// flex-shrink:0 的工具栏里——涨多少，对话区就被挤掉多少。去重与上限在这一层，
// max-height/overflow 与关闭按钮在 UI 层。硬约束「{k:'error',fatal:false} 必须显示」
// 要求的是"显示"，不是"永久占据版面且不可关闭"。
// ============================================================

test('[I5] 内容完全相同的 notice 合并成一条并计数，不是堆成两条（Claude 每次 restart 都会重推同一条）', () => {
  const same: ChatEvent = { k: 'error', message: '本次会话未开启审批保护', fatal: false }
  const v = run([ready, same, same, same])
  assert.equal(v.notices.length, 1, '同一条重复三次仍然只占一行')
  assert.equal(v.notices[0].count, 3, '但要如实告诉用户它发生过三次')
  assert.equal(v.notices[0].text, '本次会话未开启审批保护')
})

test('[I5] 去重不是丢弃——那条 notice 依然在视图里，硬约束「fatal:false 必须显示」不受影响', () => {
  const v = run([
    ready,
    { k: 'error', message: '重复的', fatal: false },
    { k: 'error', message: '重复的', fatal: false }
  ])
  assert.equal(v.notices.length, 1)
  assert.equal(v.notices[0].fatal, false)
})

test('[I5] 文本相同但 fatal 不同的两条不合并——一条是告知、一条是故障，合并会抹掉严重性差别', () => {
  const v = run([
    ready,
    { k: 'error', message: '同样的话', fatal: false },
    { k: 'error', message: '同样的话', fatal: true }
  ])
  assert.equal(v.notices.length, 2)
  assert.deepEqual(v.notices.map((n) => n.fatal), [false, true])
})

test('[I5] 重复命中的那条位置不动，不会被挪到列表末尾（跳位置会让人以为来了条新的）', () => {
  const v = run([
    ready,
    { k: 'error', message: 'A', fatal: false },
    { k: 'error', message: 'B', fatal: false },
    { k: 'error', message: 'A', fatal: false }
  ])
  assert.deepEqual(v.notices.map((n) => n.text), ['A', 'B'])
  assert.deepEqual(v.notices.map((n) => n.count), [2, 1])
})

test('[I5] 互不相同的 notice 超过上限时丢最旧的，数组不会无限长', () => {
  const events: ChatEvent[] = [ready]
  for (let i = 0; i < MAX_NOTICES + 3; i++) events.push({ k: 'error', message: `第 ${i} 条`, fatal: false })
  const v = run(events)
  assert.equal(v.notices.length, MAX_NOTICES)
  assert.equal(v.notices[0].text, '第 3 条', '丢的是最旧的三条')
  assert.equal(v.notices[MAX_NOTICES - 1].text, `第 ${MAX_NOTICES + 2} 条`, '最新的一条必须留着')
})

test('[I5] 首次出现的 notice count 就是 1，不是 0 或 undefined（UI 靠 count>已关闭时的 count 判断该不该显示）', () => {
  const v = run([ready, { k: 'error', message: '只发生过一次', fatal: false }])
  assert.equal(v.notices[0].count, 1)
})

// ── 断档：会话就绪到第一个字之间界面不能静止 ──────────────────────
// 2026-08-17 探针实测（真跑 Claude）：
//   3ms START_RESOLVED → 2523ms session.ready → 6814ms 第一个 text.delta
// 中间 4.3 秒里 busy 原来是 false（没有 running exec、也没收到过 exec.start），
// 界面上的「处理中…」消失、然后彻底静止 —— 用户报的就是这一段。

// （「session.ready 之后 busy 为真」这条不在这里重复断言——上面那条
//   「[补充] session.ready 本身不产生任何轮次（但那时已经在忙了）」已经锁住了。）

test('turn.done 之后 busy 归假——不能一直转下去', () => {
  const v = run([ready, { k: 'text.done', text: '答完了' }, { k: 'turn.done', usage: { inputTokens: 1, outputTokens: 1 } }])
  assert.equal(v.busy, false)
})

test('一轮结束后新一轮的 turn.start 重新置忙', () => {
  const v = run([
    { k: 'turn.start' },
    { k: 'text.done', text: '第一轮' },
    { k: 'turn.done', usage: { inputTokens: 1, outputTokens: 1 } },
    { k: 'turn.start' }
  ])
  assert.equal(v.busy, true)
})

test('流式途中 busy 保持为真（文字在出，轮次还没结束）', () => {
  const v = run([{ k: 'turn.start' }, ready, { k: 'text.delta', text: '正在' } as ChatEvent])
  assert.equal(v.busy, true)
})

// ── CLI 报告的当前模型（2026-08-17）──────────────────────────
// 「模型要和 CLI 一致」的落点：不自己记选择，听 session.ready 报的。
// 实测：发 /model haiku 之后 CLI 会重推一次 init，model 是新值。

test('model 取自 session.ready，不是我们自己记的选择', () => {
  assert.equal(run([]).model, null, '没有事件时不许猜一个模型名')
  assert.equal(run([ready]).model, 'sonnet')
})

test('**重推的 session.ready 会更新 model**（/model 切换后 CLI 就是这么通知的）', () => {
  const v = run([
    ready,
    { k: 'text.done', text: '好' },
    { k: 'session.ready', sessionId: 's1', model: 'claude-haiku-4-5-20251001', cwd: '/WORK/proj' }
  ])
  assert.equal(v.model, 'claude-haiku-4-5-20251001')
})

test('session.ready 的 model 为空串时不覆盖已有值（宁可显示旧的也不显示空白）', () => {
  const v = run([ready, { k: 'session.ready', sessionId: 's1', model: '', cwd: '/x' }])
  assert.equal(v.model, 'sonnet')
})

test('quota 事件按窗口去重，同一个窗口只留最新（五小时和周各一条）', () => {
  const v = run([
    { k: 'quota', window: 'five_hour', status: 'allowed', resetsAt: 100 },
    { k: 'quota', window: 'weekly', status: 'allowed', resetsAt: 200 },
    { k: 'quota', window: 'five_hour', status: 'rejected', resetsAt: 300 }
  ])
  assert.equal(v.quotas.length, 2, '同一个窗口不该堆成两条')
  assert.deepEqual(v.quotas.find((q) => q.window === 'five_hour'), {
    window: 'five_hour', status: 'rejected', resetsAt: 300, utilization: undefined
  })
  assert.equal(v.quotas.find((q) => q.window === 'weekly')?.status, 'allowed')
})

test('没收到过 quota 时是空数组（Codex 不报额度，界面就不该显示那个 chip）', () => {
  assert.deepEqual(run([ready]).quotas, [])
})

// —— 中断：点「停」之后界面要真的停下来（2026-08-20 用户反馈）——

test('turn.done 会收尾仍在跑的命令 —— 否则 busy 永远为真', () => {
  // 用户点「停」时进程正卡在一条 Bash 上，那条 exec.done 永远不会来了。
  // 不收的话 anyRunning 一直为真 → 界面上「正在处理」不消失、
  // 发送键一直停在「停下这一轮」。
  const v = run([
    ready,
    { k: 'turn.start' },
    { k: 'exec.start', execId: 'e1', label: '运行 sleep 999', detail: 'sleep 999' },
    { k: 'turn.done', usage: { inputTokens: 0, outputTokens: 0 } }
  ])
  assert.equal(v.busy, false, '一轮结束了就不该还忙着')
  const running = v.turns.flatMap((t) => t.execs).filter((x) => x.state === 'running')
  assert.equal(running.length, 0, '不该还有 running 的命令')
})

test('正常路径不受影响：exec.done 先到，状态是 ok 不是 failed', () => {
  const v = run([
    ready,
    { k: 'turn.start' },
    { k: 'exec.start', execId: 'e1', label: '运行 ls', detail: 'ls' },
    { k: 'exec.done', execId: 'e1', ok: true, output: 'a.ts' },
    { k: 'turn.done', usage: { inputTokens: 1, outputTokens: 1 } }
  ])
  const e1 = v.turns.flatMap((t) => t.execs).find((x) => x.execId === 'e1')
  assert.equal(e1?.state, 'ok', '正常跑完的不该被改成 failed')
  assert.equal(v.busy, false)
})

test('非致命提醒不会结束这一轮 —— 那只是条提示，会话还在跑', () => {
  const v = run([
    ready,
    { k: 'turn.start' },
    { k: 'error', fatal: false, message: '某个提醒' }
  ])
  assert.equal(v.busy, true, 'fatal:false 不该把正在跑的一轮判成结束')
})

// ============================================================
// user.message —— 手机端发进来的消息（2026-08-30）
//
// 这是归约器**唯一一次**产出用户消息，是对文件头那条
// 「reduce 从不产出用户消息」的显式例外。桌面自己发的不走这条
//（AgentChatView 乐观插入），只有手机那条路会。
// ============================================================

test('user.message 变成一条 role:user 的轮次', () => {
  const v = run([ready, { k: 'user.message', text: '继续，把剩下的做完' }])
  const u = v.turns.filter((t) => t.role === 'user')
  assert.equal(u.length, 1)
  assert.equal(u[0].text, '继续，把剩下的做完')
  assert.deepEqual(u[0].execs, [], '用户轮次没有执行项')
})

test('插在当前末尾 —— 后面的回答接在它下面', () => {
  const v = run([
    ready,
    { k: 'text.done', text: '第一段回答' },
    { k: 'user.message', text: '手机上补的一句' },
    { k: 'text.done', text: '针对补充的回答' }
  ])
  assert.deepEqual(
    v.turns.map((t) => `${t.role}:${t.text}`),
    ['assistant:第一段回答', 'user:手机上补的一句', 'assistant:针对补充的回答']
  )
})

test('**不打断正在流式输出的那一轮** —— 否则回答会被劈成两半', () => {
  // 手机的消息可能在 AI 正说到一半时到达。清掉 streamingTurn 的话，
  // 剩下的 delta 会另起一个轮次，界面上看起来像同一段回答断成了两条
  const r = createChatReducer()
  r.push(ready)
  r.push({ k: 'text.delta', text: '正在说' })
  r.push({ k: 'user.message', text: '插一句' })
  r.push({ k: 'text.delta', text: '的后半句' })
  const assistants = r.view().turns.filter((t) => t.role === 'assistant')
  assert.equal(assistants.length, 1, `流式那一轮被劈成了 ${assistants.length} 条`)
  assert.equal(assistants[0].text, '正在说的后半句')
})

test('多条累积，顺序不乱', () => {
  const v = run([
    ready,
    { k: 'user.message', text: '一' },
    { k: 'user.message', text: '二' },
    { k: 'user.message', text: '三' }
  ])
  assert.deepEqual(v.turns.map((t) => t.text), ['一', '二', '三'])
})

test('空文本也照样落一条 —— 由发送侧负责不发空的，归约器不替它做判断', () => {
  const v = run([ready, { k: 'user.message', text: '' }])
  assert.equal(v.turns.length, 1)
})
