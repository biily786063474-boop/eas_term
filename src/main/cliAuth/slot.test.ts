// 这些测试跑的是 2026-08-30 真实撞到的时序，不是编出来的抽象场景。
// 日志原文（cli-auth.log）：
//   04:22:47.821 用户取消登录：claude
//   04:22:47.822 登录结束：claude → canceled
//   04:22:48.249 旧登录进程退出：claude code=143（已经不是当前流程，忽略）
// kill 之后 close 事件晚了 428ms 才到 —— 那时新流程完全可能已经起来了。
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createSlot } from './slot.ts'

/** 拿对象当身份标记，跟真实代码里拿 ChildProcess 当标记是一回事 */
const proc = (name: string): object => ({ name })

test('占住之后，主人本人取得到值', () => {
  const s = createSlot<string>()
  const a = proc('a')
  s.claim(a, '登录 A')
  assert.equal(s.mine(a), '登录 A')
  assert.equal(s.busy(), true)
})

test('**别人取不到** —— 这就是身份校验', () => {
  const s = createSlot<string>()
  const a = proc('a')
  const b = proc('b')
  s.claim(a, '登录 A')
  assert.equal(s.mine(b), null)
})

test('空槽位谁都取不到', () => {
  const s = createSlot<string>()
  assert.equal(s.mine(proc('a')), null)
  assert.equal(s.any(), null)
  assert.equal(s.busy(), false)
})

// ── 真实事故：取消 → 重来 → 旧进程的 close 才到 ──────────────────────
test('**旧主人的回调不能认领新流程**（428ms 那条 race 的原样复现）', () => {
  const s = createSlot<string>()
  const old = proc('旧登录进程')
  const neu = proc('新登录进程')
  const ended: string[] = []

  // 旧流程起来时挂上的 close 回调（闭包捕获的是它自己那个 proc）
  const oldClose = s.guard(old, (v) => ended.push(`结束：${v}`))
  s.claim(old, '登录 A')

  // 用户点重试：先取消旧的，再起新的
  s.clear()
  s.claim(neu, '登录 B')

  // 428ms 后旧进程的 close 才到
  oldClose()

  assert.deepEqual(ended, [], '旧回调什么都不该做')
  assert.equal(s.mine(neu), '登录 B', '**新流程必须原封不动**')
})

test('新主人自己的回调照常生效', () => {
  const s = createSlot<string>()
  const a = proc('a')
  const got: string[] = []
  const close = s.guard(a, (v) => got.push(v))
  s.claim(a, '登录 A')
  close()
  assert.deepEqual(got, ['登录 A'])
})

test('**顶掉旧的之后，旧的所有回调一起失效**（不只是 close）', () => {
  // 真实代码里一个进程挂着 5 个回调：stdout / stderr / error / close / 超时。
  // 漏掉任何一个，旧进程都还能改到新流程的状态 ——
  // 比如旧进程的 stdout 覆盖掉新流程的登录网址，用户拿到的是过期的那份
  const s = createSlot<string>()
  const old = proc('old')
  const acted: string[] = []
  const onOut = s.guard(old, () => acted.push('stdout'))
  const onErr = s.guard(old, () => acted.push('stderr'))
  const onExit = s.guard(old, () => acted.push('exit'))
  const onTimeout = s.guard(old, () => acted.push('timeout'))
  s.claim(old, 'A')
  s.claim(proc('new'), 'B') // 直接顶掉，不经过 clear

  onOut()
  onErr()
  onExit()
  onTimeout()
  assert.deepEqual(acted, [], '旧进程的每一个回调都该哑掉')
})

test('guard 把参数原样透传（退出码这类要用得上）', () => {
  const s = createSlot<string>()
  const a = proc('a')
  let seen: unknown[] = []
  const onClose = s.guard(a, (v, code: number | null, signal: string | null) => {
    seen = [v, code, signal]
  })
  s.claim(a, 'A')
  onClose(143, 'SIGTERM')
  assert.deepEqual(seen, ['A', 143, 'SIGTERM'])
})

test('any() 不校验身份 —— 给「把状态推给界面」那种场合用', () => {
  const s = createSlot<string>()
  s.claim(proc('a'), 'A')
  assert.equal(s.any(), 'A')
})

test('clear 不校验身份 —— 用户点取消走这条', () => {
  const s = createSlot<string>()
  const a = proc('a')
  s.claim(a, 'A')
  s.clear()
  assert.equal(s.busy(), false)
  assert.equal(s.mine(a), null)
})

test('**值可以是 undefined 也不会被当成「不是主人」**', () => {
  // guard 内部若用 `if (!v) return` 就会在这里挂掉 —— 用 null 判定才对
  const s = createSlot<number>()
  const a = proc('a')
  let ran = 0
  const cb = s.guard(a, () => (ran += 1))
  s.claim(a, 0) // 0 是合法的值
  cb()
  assert.equal(ran, 1, '值为 0 时回调仍该跑')
})
