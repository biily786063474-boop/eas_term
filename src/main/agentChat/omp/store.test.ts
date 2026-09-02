import { test } from 'node:test'
import assert from 'node:assert/strict'

import { mergeProviderChoice } from './store.ts'

// ── 2026-09-02：换服务商时那条记录该留什么、该清什么 ──────────────────────
//
// `omp:saveProvider` 原本手拼这个对象，`loggedInAt` 被静默丢掉 —— 于是
// 「登录成功 → 被另一个 bug 弹回选服务商 → 再选一次同一家 → 登录记录没了」
// 形成闭环，用户怎么登都进不去。
//
// 原来这里还有个 `authMode` 参数（订阅 / 填 key）。**它已经随密钥柜一起删掉了** ——
// 那是我们自己记的一个选择，而保存模型那处调用忘了带它，于是订阅用户被静默
// 翻成「填 key」，转头被要求去填一把他根本没有的 key（2026-09-02 用户截图实拍）。
// 用户当天的结论：「取消密钥柜的概念呢，单纯用 oh my pi 成熟的登录流程然后 UI 化。」

test('**同一家**重选一次，已登录的事实必须留着', () => {
  const prev = { id: 'minimax-code-cn', loggedInAt: 1000 }
  const next = mergeProviderChoice(prev, { id: 'minimax-code-cn' })
  assert.equal(next.loggedInAt, 1000, '重选同一家把登录记录抹了 → 用户陷入「登了又要登」的死循环')
})

test('**换一家**必须把登录记录清掉 —— 登进 A 不代表登进了 B', () => {
  const prev = { id: 'minimax-code-cn', loggedInAt: 1000 }
  const next = mergeProviderChoice(prev, { id: 'zhipu-coding-plan' })
  assert.equal(next.loggedInAt, undefined, '带着上一家的登录记录 → 面板说「已登录」，一发消息就 401')
})

test('model / thinking 没给就沿用旧的，给了就换', () => {
  const prev = { id: 'deepseek', model: 'deepseek/a', thinking: 'high' }
  assert.equal(mergeProviderChoice(prev, { id: 'deepseek' }).model, 'deepseek/a')
  assert.equal(mergeProviderChoice(prev, { id: 'deepseek', model: 'deepseek/b' }).model, 'deepseek/b')
  assert.equal(mergeProviderChoice(prev, { id: 'deepseek' }).thinking, 'high')
})

test('换一家时旧的 model 也不能留 —— 那是上一家的模型名', () => {
  const prev = { id: 'deepseek', model: 'deepseek/chat' }
  assert.equal(mergeProviderChoice(prev, { id: 'zhipu-coding-plan' }).model, undefined)
})

test('没有上一次（第一次配）也要能用', () => {
  const next = mergeProviderChoice(undefined, { id: 'deepseek' })
  assert.equal(next.id, 'deepseek')
  assert.equal(next.loggedInAt, undefined)
})
