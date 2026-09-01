import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mergeUserMessages, turnCursor, type SentMessage } from './userMessages.ts'
import type { ChatView, Turn } from './reduce.ts'

const A = (text: string): Turn => ({ role: 'assistant', text, execs: [] })
const V = (turns: Turn[], trimmedFromHead = 0): ChatView => ({
  model: null, quotas: [], turns, pending: null, notices: [], usage: null, costUsd: undefined, busy: false, trimmedFromHead
})
const S = (text: string, beforeTurnCount: number): SentMessage => ({ text, beforeTurnCount })
const roles = (v: ChatView): string => v.turns.map((t) => (t.role === 'user' ? 'U' : 'a')).join('')
const texts = (v: ChatView): string[] => v.turns.filter((t) => t.role === 'user').map((t) => t.text)

test('基本：按 beforeTurnCount 插到对应位置', () => {
  const v = mergeUserMessages(V([A('a1'), A('a2')]), [S('问1', 0), S('问2', 1)])
  assert.equal(roles(v), 'UaUa')
})

test('连着发两条（中间没有回答）也要都在', () => {
  const v = mergeUserMessages(V([A('a1')]), [S('问1', 0), S('问2', 0)])
  assert.equal(roles(v), 'UUa')
})

test('发在最后一轮之后的消息要在末尾', () => {
  const v = mergeUserMessages(V([A('a1')]), [S('问1', 1)])
  assert.equal(roles(v), 'aU')
})

// ── 下面这条是这次 bug 的复现 ──────────────────────────────────────
test('**归约器从头砍掉轮次后，用户消息不能消失**', () => {
  // 场景：聊到第 60 轮，trimTurns() 从头砍掉 2 轮；或者 CLI 压缩，只留最后一轮。
  // sentMessages 里记的还是砍之前的绝对下标。
  //
  // 砍之前：a0 a1 a2 a3，用户消息记在 beforeTurnCount = 2 和 4
  // 砍掉前 2 轮之后 turns 只剩 [a2, a3]，长度 2 —— 于是 beforeTurnCount=4 永远匹配不上，
  // 而 sentIdx 是单调游标，卡在那条上，**它和它后面的所有消息一起消失**。
  const afterTrim = V([A('a2'), A('a3')], 2) // 砍了前 2 轮
  const sent = [S('问A', 2), S('问B', 4)]
  const v = mergeUserMessages(afterTrim, sent)
  assert.deepEqual(texts(v), ['问A', '问B'], '两条用户消息都该还在，一条都不能丢')
})

test('**压缩只留最后一轮时，之前的用户消息也不能全没**', () => {
  // compact 那一刀更狠：turns.splice(0, len-1)，一次砍到只剩 1 轮
  const afterCompact = V([A('最后一轮')], 3) // 砍了前 3 轮
  const sent = [S('问1', 1), S('问2', 3), S('问3', 5)]
  const v = mergeUserMessages(afterCompact, sent)
  assert.deepEqual(texts(v), ['问1', '问2', '问3'], '三条都该在')
})

test('修正之后位置也要对，不只是「没丢」', () => {
  // 砍前：a0 a1 a2 a3，问A 记在 2（a2 之前）。砍掉前 2 轮后 turns=[a2,a3]
  // 问A 应该落在 a2 之前，也就是新序列的开头
  const v = mergeUserMessages(V([A('a2'), A('a3')], 2), [S('问A', 2)])
  assert.equal(roles(v), 'Uaa')
})

test('被砍区间里的消息落到开头，不丢', () => {
  // 问A 记在 0（第一轮之前），而前 2 轮已经被砍掉了 —— 它的上下文没了，
  // 但话是用户真说过的，不能凭空消失
  const v = mergeUserMessages(V([A('a2')], 2), [S('问A', 0), S('问B', 2)])
  assert.deepEqual(texts(v), ['问A', '问B'])
  assert.equal(roles(v), 'UUa')
})

// ── turnCursor：吸顶路标能不能出现，全看这个下标口径 ─────────────────────────────
// 2026-09-01「聊久了看不到自己发的话吸顶」的根因就在这里：记录点原本用
// `view().turns.length`，而归约器每轮结束都把 turns 砍回 MAX_LIVE_TURNS 上限，
// 于是它到了上限就不再增长，所有提问减完偏移一起塌到 0。

test('turnCursor 在裁剪之后仍然单调递增（turns.length 不会）', () => {
  const at = (trimmed: number, len: number): ChatView =>
    V(Array.from({ length: len }, (_, i) => A(`a${i}`)), trimmed)
  // 砍掉多少，就在另一侧加回多少 —— 游标恒等于「一共产生过多少轮」
  assert.equal(turnCursor(at(0, 39)), 39)
  assert.equal(turnCursor(at(18, 60)), 78)
  assert.equal(turnCursor(at(135, 60)), 195)
  // 对照：turns.length 在这三个时刻是 39 / 60 / 60 —— 后两个分不开
  assert.equal(at(48, 60).turns.length, at(210, 60).turns.length)
})

test('turnCursor 没有 trimmedFromHead 字段时退回 turns.length', () => {
  const v = V([A('a1'), A('a2')])
  delete (v as { trimmedFromHead?: number }).trimmedFromHead
  assert.equal(turnCursor(v), 2)
})

test('长会话：提问按 turnCursor 记录后，落在各自答案的前面', () => {
  // 复现盘上量到的最长比例：一次提问对应 39 个 assistant 轮次
  const PER_Q = 39
  const LIVE = 60
  const trimmed = 5 * PER_Q - LIVE // 135
  const view = V(Array.from({ length: LIVE }, (_, i) => A(`答${trimmed + i}`)), trimmed)
  const sent = [0, 1, 2, 3, 4].map((q) => S(`问${q}`, q * PER_Q))
  const pos = mergeUserMessages(view, sent)
    .turns.map((t, i) => (t.role === 'user' ? i : -1))
    .filter((i) => i >= 0)
  // 前四问的答案确实已经被砍出内存，收拢到开头是诚实的位置；
  // **第五问必须落在它那 54 段答案的前面**，而不是跟着一起塌到 0 ——
  // 那正是「读答案时顶上钉着哪条提问」的分水岭。
  assert.deepEqual(pos, [0, 1, 2, 3, 4 + (4 * PER_Q - trimmed)])
  assert.ok(pos[4] > 4, '第五问不能塌到开头')
})
