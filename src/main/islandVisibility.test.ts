import { test } from 'node:test'
import assert from 'node:assert/strict'
import { islandShouldShow, acceptHold, type IslandVisibility } from './islandVisibility.ts'

const V = (over: Partial<IslandVisibility> = {}): IslandVisibility => ({
  enabled: true,
  mainForeground: false,
  hasContent: true,
  hasApproval: false,
  held: false,
  ...over
})

test('总开关关掉 → 任何情况都不出现', () => {
  assert.equal(islandShouldShow(V({ enabled: false, hasApproval: true })), false)
  assert.equal(islandShouldShow(V({ enabled: false, held: true, mainForeground: true })), false)
})

// ── 核心：和前台的主体软件互斥 ────────────────────────────────────────────────

test('**主体在前台 → 让位**，哪怕有终端在跑、有通知、甚至有等审批的', () => {
  assert.equal(islandShouldShow(V({ mainForeground: true })), false)
  assert.equal(islandShouldShow(V({ mainForeground: true, hasApproval: true })), false)
})

test('前台唯一的例外是用户主动要它留着（held）', () => {
  assert.equal(islandShouldShow(V({ mainForeground: true, held: true })), true)
  // 但没内容时连 held 也留不住 —— 留一个空壳挡着标题栏没有意义
  assert.equal(islandShouldShow(V({ mainForeground: true, held: true, hasContent: false })), false)
})

test('held 只在前台这一档起作用，不影响后台的判定', () => {
  // 后台有内容本来就该显示，held 是真是假都一样
  assert.equal(islandShouldShow(V({ held: true })), true)
  assert.equal(islandShouldShow(V({ held: false })), true)
  // **不能变成「held 才显示」** —— 那样后台跑着任务就再也看不到岛了
  assert.equal(islandShouldShow(V({ held: false, hasContent: true })), true)
})

test('后台：等审批的通知有特权，没别的内容也要露面', () => {
  assert.equal(islandShouldShow(V({ hasContent: false, hasApproval: true })), true)
  assert.equal(islandShouldShow(V({ hasContent: false, hasApproval: false })), false)
})

// ── acceptHold：挡住岛自己在前台把自己顶出来 ──────────────────────────────────

test('前台时不接受「留着」的请求 —— 岛不能自己决定在前台露面', () => {
  assert.equal(acceptHold(true, true), false)
})

test('后台时接受', () => {
  assert.equal(acceptHold(true, false), true)
})

test('松手任何时候都接受 —— 「收起来」不需要许可', () => {
  assert.equal(acceptHold(false, true), true)
  assert.equal(acceptHold(false, false), true)
})

// ── 三条用户明说的场景，逐条钉住 ─────────────────────────────────────────────

test('场景一：从岛上点进软件 → 清 held 之后，主体一到前台岛就没了', () => {
  // 点的那一刻主体还没激活（osascript 是异步的），岛还在后台档，仍然显示
  assert.equal(islandShouldShow(V({ mainForeground: false, held: false })), true)
  // 激活到位 → 让位
  assert.equal(islandShouldShow(V({ mainForeground: true, held: false })), false)
})

test('场景二：前台时岛露着（用户叫出来的），点了非岛区域清掉 held → 当场退场', () => {
  const shown = V({ mainForeground: true, held: true })
  assert.equal(islandShouldShow(shown), true)
  assert.equal(islandShouldShow({ ...shown, held: false }), false)
})

test('场景三：岛被销毁时忘了清 held 的话，下次会凭空压在前台软件上', () => {
  // 这是修复前真实存在的一条：内容清零 → 岛销毁（held 没清）→ 新任务来了、
  // 而人正在软件里干活 → hasContent && held ⇒ 岛自己蹦出来盖住标题栏
  assert.equal(islandShouldShow(V({ mainForeground: true, hasContent: true, held: true })), true)
  // 销毁时清掉 held 之后就不会了
  assert.equal(islandShouldShow(V({ mainForeground: true, hasContent: true, held: false })), false)
})
