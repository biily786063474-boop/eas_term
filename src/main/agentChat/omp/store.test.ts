import { test } from 'node:test'
import assert from 'node:assert/strict'

import { mergeProviderChoice, ompKeyVarNames } from './store.ts'

// ── 2026-09-02 真机事故的第二条根因 ────────────────────────────────────────
//
// `omp:saveProvider` 原本把 provider 整个对象重建：`{ id, authMode, model, thinking }`。
// **`loggedInAt` 不在里面** —— 于是「登录成功 → 因为另一条 bug 被弹回选服务商 →
// 再选一次同一家 → 登录记录被抹掉 → 又要重登」形成闭环，用户怎么登都进不去。
//
// 现场证据：用户的 omp-setup.json 里 provider 与 authMode 都在，独独没有 loggedInAt。

test('**同一家**重选一次，已登录的事实必须留着', () => {
  const prev = { id: 'minimax-code-cn', authMode: 'subscription' as const, loggedInAt: 1000 }
  const next = mergeProviderChoice(prev, { id: 'minimax-code-cn', authMode: 'subscription' })
  assert.equal(next.loggedInAt, 1000, '重选同一家把登录记录抹了 → 用户陷入「登了又要登」的死循环')
})

test('**换一家**必须把登录记录清掉 —— 登进 A 不代表登进了 B', () => {
  const prev = { id: 'minimax-code-cn', authMode: 'subscription' as const, loggedInAt: 1000 }
  const next = mergeProviderChoice(prev, { id: 'zhipu', authMode: 'subscription' })
  assert.equal(next.loggedInAt, undefined, '带着上一家的登录记录 → 面板说「已登录」，一发消息就 401')
})

test('从订阅改成填 key（同一家）也要清 —— 两条路的凭证不是一回事', () => {
  const prev = { id: 'minimax-code-cn', authMode: 'subscription' as const, loggedInAt: 1000 }
  const next = mergeProviderChoice(prev, { id: 'minimax-code-cn', authMode: 'apikey' })
  assert.equal(next.loggedInAt, undefined)
})

test('model / thinking 没给就沿用旧的，给了就换', () => {
  const prev = { id: 'deepseek', authMode: 'apikey' as const, model: 'a', thinking: 'high' }
  assert.equal(mergeProviderChoice(prev, { id: 'deepseek', authMode: 'apikey' }).model, 'a')
  assert.equal(mergeProviderChoice(prev, { id: 'deepseek', authMode: 'apikey', model: 'b' }).model, 'b')
  assert.equal(mergeProviderChoice(prev, { id: 'deepseek', authMode: 'apikey' }).thinking, 'high')
})

test('换一家时旧的 model 也不能留 —— 那是上一家的模型名', () => {
  const prev = { id: 'deepseek', authMode: 'apikey' as const, model: 'deepseek/chat' }
  assert.equal(mergeProviderChoice(prev, { id: 'zhipu', authMode: 'apikey' }).model, undefined)
})

test('没有上一次（第一次配）也要能用', () => {
  const next = mergeProviderChoice(undefined, { id: 'deepseek', authMode: 'apikey' })
  assert.equal(next.id, 'deepseek')
  assert.equal(next.loggedInAt, undefined)
})

test('订阅那条路不往柜子里要 key（原有约定，别被这次改动带坏）', () => {
  assert.deepEqual(ompKeyVarNames({ provider: { id: 'minimax-code-cn', authMode: 'subscription' } }), [])
})
