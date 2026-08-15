import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createChatReducer, visibleExecs } from './reduce.ts'
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

test('[补充] session.ready 本身不产生任何轮次，初始态是空闲的', () => {
  const v = run([ready])
  assert.deepEqual(v.turns, [])
  assert.equal(v.pending, null)
  assert.equal(v.busy, false)
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

test('[补充] text.delta 不会把文字追加到已经 text.done 完成的轮次上（没有打字机态，不只是不崩）', () => {
  const v = run([
    ready,
    { k: 'text.done', text: '完整的话' },
    { k: 'text.delta', text: '追加？' } as ChatEvent
  ])
  assert.equal(v.turns.length, 1)
  assert.equal(v.turns[0].text, '完整的话')
})
