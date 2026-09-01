import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mergeUserMessages, type SentMessage } from './userMessages.ts'
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
