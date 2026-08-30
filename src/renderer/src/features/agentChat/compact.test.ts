// A（内存上限）与 B（压缩同步）的测试。单独成文件而不是塞进 reduce.test.ts：
// 那份测的是「事件怎么变成气泡」，这份测的是「什么时候该丢东西」——
// 两件事的失败方式完全不同，混在一起以后不好找。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createChatReducer, MAX_LIVE_OUTPUT, MAX_LIVE_TURNS } from './reduce.ts'
import { trimForSave } from './history.ts'
import type { ChatEvent } from '../../../../shared/agentChat.ts'

const usage = { inputTokens: 0, outputTokens: 0 }
/** 一整轮：开始 → 说一句 → 结束。裁剪挂在 turn.done 上，所以必须走完整轮 */
const oneTurn = (text: string): ChatEvent[] => [
  { k: 'turn.start' },
  { k: 'text.done', text },
  { k: 'turn.done', usage }
]
function run(events: ChatEvent[]) {
  const r = createChatReducer()
  for (const e of events) r.push(e)
  return r.view()
}

// ── A · 内存上限 ────────────────────────────────────────────────
test('轮次超过上限时从头砍，末尾保留最新的', () => {
  const evts: ChatEvent[] = []
  for (let i = 0; i < MAX_LIVE_TURNS + 25; i++) evts.push(...oneTurn('第 ' + i + ' 轮'))
  const v = run(evts)
  assert.equal(v.turns.length, MAX_LIVE_TURNS)
  assert.equal(v.turns[v.turns.length - 1].text, '第 ' + (MAX_LIVE_TURNS + 24) + ' 轮')
  assert.equal(v.turns[0].text.startsWith('第 25'), true, '砍的是最老的那些')
})

test('没超上限时一条都不动', () => {
  const evts: ChatEvent[] = []
  for (let i = 0; i < 10; i++) evts.push(...oneTurn('第 ' + i + ' 轮'))
  assert.equal(run(evts).turns.length, 10)
})

test('裁剪只从头上砍，**最新那一轮永远保留** —— 流式与 running exec 只可能在它上面', () => {
  const evts: ChatEvent[] = []
  for (let i = 0; i < MAX_LIVE_TURNS + 20; i++) evts.push(...oneTurn('t' + i))
  // 最后一轮开着、还挂着没收的命令
  evts.push({ k: 'turn.start' }, { k: 'text.done', text: '最新这轮' },
    { k: 'exec.start', execId: 'live', label: 'x', detail: '' })
  const r = createChatReducer()
  for (const e of evts) r.push(e)
  const v = r.view()
  assert.equal(v.turns[v.turns.length - 1].text, '最新这轮')
  assert.equal(v.turns[v.turns.length - 1].execs[0].state, 'running', '没被裁剪波及')
})

test('**裁剪之后 exec.done 仍然落得回去** —— 这是裁剪不能破坏的那条不变量', () => {
  const r = createChatReducer()
  // 先撑到超过上限，逼出多次裁剪
  for (let i = 0; i < MAX_LIVE_TURNS + 30; i++) for (const e of oneTurn('t' + i)) r.push(e)
  // 再发一条命令，结果隔一会儿才回来
  r.push({ k: 'turn.start' })
  r.push({ k: 'text.done', text: '跑命令' })
  r.push({ k: 'exec.start', execId: 'late', label: 'npm test', detail: '' })
  r.push({ k: 'exec.done', execId: 'late', ok: true, output: '922 passed' })
  const t = r.view().turns.find((x) => x.execs.some((e) => e.execId === 'late'))
  assert.equal(t?.execs[0].state, 'ok', '结果必须落回它自己那一轮，不能变成转不停的圈')
  assert.equal(t?.execs[0].output, '922 passed')
})

test('exec 结果仍能落回它自己那一轮（裁剪没打断按 execId 的查找）', () => {
  const r = createChatReducer()
  r.push({ k: 'turn.start' })
  r.push({ k: 'text.done', text: 'a' })
  r.push({ k: 'exec.start', execId: 'e1', label: 'ls', detail: '' })
  r.push({ k: 'exec.done', execId: 'e1', ok: true, output: '结果' })
  r.push({ k: 'turn.done', usage })
  const t = r.view().turns.find((x) => x.execs.length)
  assert.equal(t?.execs[0].state, 'ok')
  assert.equal(t?.execs[0].output, '结果')
})

test('超长命令输出进内存就截，并明说截了多少', () => {
  const huge = 'x'.repeat(MAX_LIVE_OUTPUT + 5000)
  const v = run([
    { k: 'turn.start' },
    { k: 'exec.start', execId: 'e', label: 'build', detail: '' },
    { k: 'exec.done', execId: 'e', ok: true, output: huge },
    { k: 'turn.done', usage }
  ])
  const out = v.turns[0].execs[0].output ?? ''
  assert.ok(out.length < huge.length, '必须截')
  assert.ok(out.includes('已截断'), '**要明说** —— 静默截会让人以为日志就这么长')
  assert.ok(out.includes(String(huge.length)), '把原长写出来')
})

test('没超长的输出原样保留，一个字都不动', () => {
  const v = run([
    { k: 'turn.start' },
    { k: 'exec.start', execId: 'e', label: 'ls', detail: '' },
    { k: 'exec.done', execId: 'e', ok: true, output: '短输出' },
    { k: 'turn.done', usage }
  ])
  assert.equal(v.turns[0].execs[0].output, '短输出')
})

// ── B · 压缩同步 ────────────────────────────────────────────────
test('收到 compacted：丢掉之前的轮次，插一条分隔标记', () => {
  const evts: ChatEvent[] = []
  for (let i = 0; i < 12; i++) evts.push(...oneTurn('旧 ' + i))
  evts.push({ k: 'compacted', trigger: 'auto', preTokens: 1003232, postTokens: 37406 })
  const v = run(evts)
  assert.equal(v.turns[0].compact?.trigger, 'auto')
  assert.equal(v.turns[0].compact?.preTokens, 1003232)
  assert.ok((v.turns[0].compact?.droppedTurns ?? 0) > 0)
  // 标记之后只剩最后那一轮
  assert.equal(v.turns.length, 2)
  assert.equal(v.turns[1].text, '旧 11', '**当前这一轮不能砍** —— 压缩发生在两轮之间')
})

test('压缩标记本身不是消息：text 为空、没有 execs', () => {
  const v = run([...oneTurn('a'), { k: 'compacted', trigger: 'manual', preTokens: 0, postTokens: 0 }])
  assert.equal(v.turns[0].text, '')
  assert.deepEqual(v.turns[0].execs, [])
})

test('压缩发生在一轮进行到一半时：**正在流的那一轮保住，它之前的一个不留**', () => {
  const r = createChatReducer()
  for (const e of oneTurn('更早的 A')) r.push(e)
  for (const e of oneTurn('更早的 B')) r.push(e)
  r.push({ k: 'turn.start' })
  r.push({ k: 'text.done', text: '正在回答' })
  r.push({ k: 'exec.start', execId: 'e', label: 'x', detail: '' })
  r.push({ k: 'compacted', trigger: 'auto', preTokens: 100, postTokens: 10 })
  const v = r.view()
  // 标记 + 正在回答，就这两条
  assert.equal(v.turns.length, 2)
  assert.equal(v.turns[0].compact?.trigger, 'auto')
  assert.equal(v.turns[1].text, '正在回答', '正在流的那一轮不能砍')
  assert.equal(v.turns[1].execs[0].state, 'running')
  assert.equal(
    v.turns.some((t) => t.text.startsWith('更早的')),
    false,
    '**它之前的一轮都不能留** —— 模型已经不记得了，留在界面上正是这次要治的病'
  )
})

test('trigger 三态原样透传，**包括「不知道」**', () => {
  // 2026-08-29 真机实测：app 的 stream-json 里 compact_boundary 不带
  // compactMetadata，所以 null 是常态而不是边角情况。
  // 归约器不能把 null 补成 auto —— 界面拿到 auto 会说「上下文满了」，
  // 而那次可能是用户自己点的压缩。
  for (const t of ['auto', 'manual', null] as const) {
    const v = run([{ k: 'compacted', trigger: t, preTokens: 1, postTokens: 1 }])
    assert.equal(v.turns[0].compact?.trigger, t)
  }
})

test('空对话时压缩不抛，也不产出假数据', () => {
  const v = run([{ k: 'compacted', trigger: 'auto', preTokens: 0, postTokens: 0 }])
  assert.equal(v.turns.length, 1)
  assert.equal(v.turns[0].compact?.droppedTurns, 0)
})

// ── 落盘 ────────────────────────────────────────────────────────
test('**压缩标记要落盘** —— 丢了的话重开又回到「界面有历史、模型不记得」', () => {
  const turns = [
    { role: 'assistant' as const, text: '', execs: [],
      compact: { trigger: 'auto' as const, preTokens: 100, postTokens: 10, droppedTurns: 5 } },
    { role: 'assistant' as const, text: '之后的', execs: [] }
  ]
  const saved = trimForSave(turns)
  assert.equal(saved[0].compact?.droppedTurns, 5)
  assert.equal(saved[0].compact?.preTokens, 100)
})

test('没有压缩标记的普通轮次不会凭空长出这个字段', () => {
  const saved = trimForSave([{ role: 'assistant', text: 'a', execs: [] }])
  assert.equal('compact' in saved[0], false)
})
