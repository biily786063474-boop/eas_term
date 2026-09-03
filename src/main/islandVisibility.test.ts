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

// ── 2026-09-02：点了「进软件」之后，岛必须当场让开 ──────────────────────────
//
// 用户报的：「最大化软件的情况下，用户点击灵动岛进入软件的时候，
// 还是会灵动岛没退后台、主软件的点击（被它接走）。」
//
// **根因不在 held，在这个函数的后台分支**：
// `dispatchAction` 的 focus 分支一直有 `releaseHold('从岛上点了进来')`，
// 但那一刻 `mainForeground` 还是 false（激活是异步的），于是判定落到后台分支
// `return v.hasContent` —— **那条分支压根不看 held**。清了等于没清。
//
// 于是从「点岛」到「窗口真拿到焦点」这一整段，岛都还挂在屏幕最上沿。
// 窗口态下这段约 100ms 不太看得出来；**全屏态下它是一次 Space 切换动画**，
// 而展开态的岛有 82px 高、主窗口在全屏下从 y=26 开始 —— 正好盖住 app 顶上 56px
// 那条（标题栏/标签栏）。用户以为点的是软件，点到的是岛。

test('**点了进软件 → 当场不显示**，不等激活到位（后台分支也管得住）', () => {
  const base = { enabled: true, mainForeground: false, hasContent: true, hasApproval: false, held: false }
  assert.equal(islandShouldShow(base), true, '前提：本来是要显示的')
  assert.equal(islandShouldShow({ ...base, enteringApp: true }), false)
})

test('等审批也压得住 —— 用户正要进软件，审批在软件里看得到', () => {
  // 后台那条「审批有特权」的规则不能盖过这个意图，否则有审批时岛照样挡着。
  assert.equal(
    islandShouldShow({ enabled: true, mainForeground: false, hasContent: true, hasApproval: true, held: false, enteringApp: true }),
    false
  )
})

test('进到前台之后仍然不显示 —— 意图和前台判定说的是同一件事', () => {
  assert.equal(
    islandShouldShow({ enabled: true, mainForeground: true, hasContent: true, hasApproval: false, held: true, enteringApp: true }),
    false
  )
})

test('**不传这个字段时行为一个字都不变**', () => {
  // 老调用点（设置面板改开关、内容变化）不会传它，那些路径的判定必须原样。
  for (const mainForeground of [true, false])
    for (const hasContent of [true, false])
      for (const hasApproval of [true, false])
        for (const held of [true, false]) {
          const v = { enabled: true, mainForeground, hasContent, hasApproval, held }
          assert.equal(islandShouldShow(v), islandShouldShow({ ...v, enteringApp: false }))
        }
})
