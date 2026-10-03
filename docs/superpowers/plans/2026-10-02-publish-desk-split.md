# 发布台分屏 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 发布台插件能把各平台发布页放进画布上一个专用的「发布分屏」子 Frame（最多 6 格、3×2），每格顶上是插件自己的头条小面板（复制 / 标记已发布）。

**Architecture:** 宿主新增面板宿主动作 `panel/split.open`（渲染层处理，点击闸门同 `panel/clipboard.write`），由纯函数 `planSplit` / `splitLayout` 决定新增、复用、替换与坐标；网页节点 `pane` 加可选 `companion`，渲染时在网页上方嵌一个插件面板（复用 `PluginPanel`，`embedded` 模式）。插件新增 `cell` 面板和挑选规则 `pickForSplit`，旧宿主不声明能力时退回单开网页。

**Tech Stack:** Electron + React + zustand（渲染层 store），TypeScript，`node --test`，插件为无依赖 ESM + 单文件 HTML 面板。

**Spec:** `docs/superpowers/specs/2026-10-02-发布台分屏-design.md`

## Global Constraints

- 分屏最多 6 格；宿主把 `max` 夹到 `[1, 6]`。
- 替换规则：已发布里 `openedAt` 最早的先换；都没发 → `openedAt` 最早的换；key 已在分屏 → reused，不新开。
- 排版：每格 420 × 520（网页 476 + 头条 44），间距 16，Frame 内边距沿用 `PAD`、标题高 `HEAD`；1–3 格一行 n 列，4 格 2×2，5–6 格 3 列 × 2 行，按 `openedAt` 从左到右、从上到下。
- `panel/split.open` 闸门：本地插件 + 焦点在面板 iframe + `navigator.userActivation.isActive`（与 `panel/clipboard.write` 相同）+ 清单 `permissions.split === true` + 每个 `companion.panelId` 必须是本插件清单里的面板 + url 必须 `http(s)`。
- 分屏格子（带 `companion` 的网页节点）**不算内容模块**，不参与 `CONTENT_CAP = 5` 的淘汰。
- 插件版本 0.1.2，`minHostVersion` 仍为 `0.4.120`；无 `hostCapabilities.experimental.eas.split` 时隐藏「分屏打开」，卡片「打开发布页」退回 `ui/open-link`。
- 新的宿主界面文案（如有）中英同提交；插件面板文案只有中文（现有限制）。
- 改代码同提交更新图纸：10a（渲染层）、10d（专题）、11（新宿主动作）、03b + 03 索引（点击闸门护栏）。
- Node：`~/.cache/eas-release-tools/node-v22.23.3-darwin-arm64/bin`；测试 `node --test <file>`；全量 `npm run check`。

---

### Task 1: 分屏纯函数（排版 + 新增/复用/替换）

**Files:**
- Create: `src/shared/splitView.ts`（只放跨层共用的类型 `SplitWant`）
- Create: `src/renderer/src/store/canvas/splitLayout.ts`
- Test: `src/renderer/src/store/canvas/splitLayout.test.ts`

**Interfaces:**
- Produces:
  - `export const SPLIT_MAX = 6`
  - `export const SPLIT_CELL = { w: 420, h: 520, gap: 16 }`
  - `export interface SplitCellNow { key: string; nodeId: string; openedAt: number }`
  - `src/shared/splitView.ts`：`export interface SplitWant { key: string; url: string; companion: { panelId: string; props: Record<string, unknown> } }`（`splitLayout.ts` 用 `export type { SplitWant } from '../../../../shared/splitView'` 转出）
  - `export interface SplitPlan { add: SplitWant[]; reuse: string[]; replace: Array<{ out: SplitCellNow; in: SplitWant }>; skipped: string[] }`
  - `export function planSplit(now: readonly SplitCellNow[], want: readonly SplitWant[], published: readonly string[], max: number): SplitPlan`
  - `export function splitLayout(n: number): { cols: number; rows: number; slots: Array<{ x: number; y: number }>; w: number; h: number }`（slot 坐标相对 Frame 内容区左上角；w/h 是内容区宽高）

- [ ] **Step 1: 写失败的测试**

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planSplit, splitLayout, SPLIT_CELL } from './splitLayout.ts'

const w = (key: string) => ({ key, url: `https://${key}.com`, companion: { panelId: 'cell', props: { platform: key } } })
const c = (key: string, openedAt: number) => ({ key, nodeId: 'n-' + key, openedAt })

test('有空位：新增；已在：复用', () => {
  const p = planSplit([c('x', 1)], [w('x'), w('reddit')], [], 6)
  assert.deepEqual(p.reuse, ['x'])
  assert.deepEqual(p.add.map((a) => a.key), ['reddit'])
  assert.equal(p.replace.length, 0)
})

test('满了：先换已发布里最早的', () => {
  const now = [c('a', 1), c('b', 2), c('c', 3), c('d', 4), c('e', 5), c('f', 6)]
  const p = planSplit(now, [w('g')], ['c', 'e'], 6)
  assert.deepEqual(p.replace.map((r) => [r.out.key, r.in.key]), [['c', 'g']])
})

test('满了且都没发：换最早打开的', () => {
  const now = [c('a', 5), c('b', 2), c('c', 3), c('d', 4), c('e', 1), c('f', 6)]
  const p = planSplit(now, [w('g')], [], 6)
  assert.deepEqual(p.replace.map((r) => r.out.key), ['e'])
})

test('一次要的比空位多：同一批里刚放进来的不会被同批替换掉', () => {
  const now = [c('a', 1), c('b', 2), c('c', 3), c('d', 4), c('e', 5)]
  const p = planSplit(now, [w('f'), w('g'), w('h')], [], 6)
  assert.deepEqual(p.add.map((a) => a.key), ['f'])
  assert.deepEqual(p.replace.map((r) => r.out.key), ['a', 'b'])
})

test('max 夹到 1..6；超过 6 个 want 只处理前 6 个', () => {
  const p = planSplit([], ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(w), [], 99)
  assert.equal(p.add.length, 6)
  assert.deepEqual(p.skipped, ['g'])
})

test('排版：1-3 一行，4 是 2x2，5-6 是 3x2', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6].map((n) => { const l = splitLayout(n); return [l.cols, l.rows] }), [[1, 1], [2, 1], [3, 1], [2, 2], [3, 2], [3, 2]])
  const l = splitLayout(5)
  assert.deepEqual(l.slots[3], { x: 0, y: SPLIT_CELL.h + SPLIT_CELL.gap })
  assert.equal(l.w, 3 * SPLIT_CELL.w + 2 * SPLIT_CELL.gap)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test src/renderer/src/store/canvas/splitLayout.test.ts`
Expected: FAIL（`Cannot find module './splitLayout.ts'`）

- [ ] **Step 3: 实现**

`src/shared/splitView.ts`：

```ts
// 插件发布分屏（panel/split.open）请求里的一格。shared 层：宿主判定（panelHostActions）与渲染层计算（store/canvas/splitLayout）共用
export interface SplitWant { key: string; url: string; companion: { panelId: string; props: Record<string, unknown> } }
```

`splitLayout.ts`：

```ts
// 发布分屏（插件 panel/split.open）的纯计算：放哪几格、换掉谁、怎么排。无 DOM、无 store，node --test 裸跑。
// 规则见 docs/superpowers/specs/2026-10-02-发布台分屏-design.md。
export const SPLIT_MAX = 6
export const SPLIT_CELL = { w: 420, h: 520, gap: 16 }

import type { SplitWant } from '../../../../shared/splitView'
export type { SplitWant }
export interface SplitCellNow { key: string; nodeId: string; openedAt: number }
export interface SplitPlan { add: SplitWant[]; reuse: string[]; replace: Array<{ out: SplitCellNow; in: SplitWant }>; skipped: string[] }

export function planSplit(now: readonly SplitCellNow[], want: readonly SplitWant[], published: readonly string[], max: number): SplitPlan {
  const cap = Math.max(1, Math.min(SPLIT_MAX, Math.floor(max) || SPLIT_MAX))
  const plan: SplitPlan = { add: [], reuse: [], replace: [], skipped: [] }
  const seen = new Set<string>()
  const list = want.filter((x) => (seen.has(x.key) ? false : (seen.add(x.key), true)))
  for (const x of list.slice(cap)) plan.skipped.push(x.key)
  // 可被换掉的：已有格子里、不在这批要的里面的；已发布优先，同档按 openedAt 早的先
  const keep = new Set(list.slice(0, cap).map((x) => x.key))
  const pub = new Set(published)
  const victims = now
    .filter((cell) => !keep.has(cell.key))
    .sort((a, b) => Number(pub.has(b.key)) - Number(pub.has(a.key)) || a.openedAt - b.openedAt)
  let free = cap - now.length
  for (const x of list.slice(0, cap)) {
    if (now.some((cell) => cell.key === x.key)) { plan.reuse.push(x.key); continue }
    if (free > 0) { plan.add.push(x); free--; continue }
    const out = victims.shift()
    if (out) plan.replace.push({ out, in: x })
    else plan.skipped.push(x.key)
  }
  return plan
}

export function splitLayout(n: number): { cols: number; rows: number; slots: Array<{ x: number; y: number }>; w: number; h: number } {
  const k = Math.max(0, Math.min(SPLIT_MAX, n))
  const cols = k <= 3 ? Math.max(1, k) : k === 4 ? 2 : 3
  const rows = k <= 3 ? 1 : 2
  const { w, h, gap } = SPLIT_CELL
  const slots = Array.from({ length: k }, (_, i) => ({ x: (i % cols) * (w + gap), y: Math.floor(i / cols) * (h + gap) }))
  return { cols, rows, slots, w: cols * w + (cols - 1) * gap, h: rows * h + (rows - 1) * gap }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test src/renderer/src/store/canvas/splitLayout.test.ts`
Expected: PASS（6 个测试）

- [ ] **Step 5: 提交**

```bash
git add src/shared/splitView.ts src/renderer/src/store/canvas/splitLayout.ts src/renderer/src/store/canvas/splitLayout.test.ts
git commit -m "feat(canvas): pure split-view planning and 3x2 layout for plugin publish pages"
```

---

### Task 2: 类型 + 分屏格子不算内容模块

**Files:**
- Modify: `src/renderer/src/layout.ts:131`（web pane 加 `companion`）
- Modify: `src/renderer/src/store/canvas/types.ts`（`CanvasFrame.owner`）
- Modify: `src/renderer/src/store/canvas/nodeCap.ts`（`isContentNode`）
- Test: `src/renderer/src/store/canvas/nodeCap.test.ts`（追加）

**Interfaces:**
- Produces:
  - `PaneState` web 变体：`{ kind: 'web'; url: string | null; title?: string; companion?: WebCompanion }`
  - `export interface WebCompanion { pluginId: string; panelId: string; props: Record<string, unknown>; key: string; openedAt: number }`（从 `layout.ts` 导出）
  - `CanvasFrame.owner?: { pluginId: string; purpose: 'split' }`

- [ ] **Step 1: 写失败的测试**（追加到 `nodeCap.test.ts` 末尾）

```ts
test('发布分屏的格子（带 companion 的网页）不算内容模块：满 6 格不会淘汰第一格', () => {
  const cell = (i: number) => ({ id: 'c' + i, x: 0, y: 0, w: 420, h: 520, pane: { kind: 'web' as const, url: 'https://x.com', companion: { pluginId: 'eas:publish-desk', panelId: 'cell', props: {}, key: 'k' + i, openedAt: i } } })
  assert.equal(isContentNode(cell(1)), false)
  assert.deepEqual(nodesToEvict([1, 2, 3, 4, 5, 6].map(cell)), [])
})
```

（若文件头没有导入 `isContentNode`，把 import 改成 `import { isContentNode, nodesToEvict, ... } from './nodeCap.ts'`。）

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test src/renderer/src/store/canvas/nodeCap.test.ts`
Expected: FAIL（`isContentNode` 返回 true）

- [ ] **Step 3: 实现**

`layout.ts` 把 131 行改为：

```ts
  | { kind: 'web'; url: string | null; title?: string; companion?: WebCompanion }
```

并在 `PaneState` 定义前加：

```ts
/** 插件发布分屏的格子：网页上方嵌一个插件自己的面板（如发布台的复制 / 标记头条）。
 *  key 是分屏内的身份（平台 id），openedAt 是放进分屏的时刻（替换规则用，见 store/canvas/splitLayout.ts）。 */
export interface WebCompanion { pluginId: string; panelId: string; props: Record<string, unknown>; key: string; openedAt: number }
```

`store/canvas/types.ts` 的 `CanvasFrame` 里（`teamMode` 之后）加：

```ts
  /** 由插件管理的子 Frame（目前只有发布分屏）。有它的 Frame 由 openSplit 找到并复用，用户仍可拖动、删除。 */
  owner?: { pluginId: string; purpose: 'split' }
```

`nodeCap.ts` 的 `isContentNode` 在 `if (n.component) return false` 之后加：

```ts
  // 发布分屏的格子：插件管着（最多 6 格、有自己的替换规则），不跟文件预览抢 5 个名额 ——
  // 不排除的话第 6 格一放进去，第一格就被当成「最早的内容」清掉了
  if (n.pane?.kind === 'web' && n.pane.companion) return false
```

- [ ] **Step 4: 跑测试确认通过 + 类型检查**

Run: `node --test src/renderer/src/store/canvas/nodeCap.test.ts && npm run -s typecheck`
Expected: PASS，typecheck 退出 0

- [ ] **Step 5: 提交**

```bash
git add src/renderer/src/layout.ts src/renderer/src/store/canvas/types.ts src/renderer/src/store/canvas/nodeCap.ts src/renderer/src/store/canvas/nodeCap.test.ts
git commit -m "feat(canvas): web companion and frame owner types; split cells don't count toward the content cap"
```

---

### Task 3: store 动作 `openSplit`（建 / 找子 Frame、应用计划、排版、对准）

**Files:**
- Create: `src/renderer/src/store/canvas/applySplit.ts`（纯函数，改 frames 数组）
- Test: `src/renderer/src/store/canvas/applySplit.test.ts`
- Modify: `src/renderer/src/store/canvas/types.ts`（action 签名）
- Modify: `src/renderer/src/store/canvasSlice.ts`（实现 action）

**Interfaces:**
- Consumes: `planSplit`, `splitLayout`, `SPLIT_CELL` (Task 1)；`WebCompanion`, `CanvasFrame.owner` (Task 2)
- Produces:
  - `export interface SplitRequest { pluginId: string; parentFrameId: string; title: string; max: number; cells: SplitWant[]; published: string[] }`
  - `export interface SplitResult { frameId: string; opened: string[]; reused: string[]; replaced: Array<{ out: string; in: string }> }`
  - `export function applySplit(frames: readonly CanvasFrame[], req: SplitRequest, now: number, newId: (p: string) => string): { frames: CanvasFrame[]; result: SplitResult } | null`（父 Frame 不存在返回 null）
  - store：`openSplit: (req: SplitRequest) => SplitResult | null`；`flashNode: (nodeId: string) => void` 与状态 `flashNodeId: string | null`

- [ ] **Step 1: 写失败的测试**

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applySplit } from './applySplit.ts'
import type { CanvasFrame } from './types.ts'

const parent: CanvasFrame = { id: 'p', projectId: 'proj', name: 'demo', x: 0, y: 0, w: 900, h: 600, collapsed: false, nodes: [] }
let n = 0; const id = (p: string) => `${p}-${++n}`
const want = (key: string) => ({ key, url: `https://${key}.com`, companion: { panelId: 'cell', props: { platform: key } } })
const req = (keys: string[], published: string[] = []) => ({ pluginId: 'eas:publish-desk', parentFrameId: 'p', title: '发布分屏 · 测试', max: 6, cells: keys.map(want), published })

test('第一次：建一个带 owner 的子 Frame，放进格子并排版', () => {
  const r = applySplit([parent], req(['x', 'reddit']), 100, id)!
  const sub = r.frames.find((f) => f.owner?.purpose === 'split')!
  assert.equal(sub.parentId, 'p')
  assert.equal(sub.name, '发布分屏 · 测试')
  assert.deepEqual(sub.nodes.map((x) => x.pane?.kind === 'web' && x.pane.companion?.key), ['x', 'reddit'])
  assert.deepEqual(r.result.opened, ['x', 'reddit'])
  assert.notEqual(sub.nodes[0].x, sub.nodes[1].x)
})

test('第二次：复用同一个子 Frame；已在的 reused；满了替换并就地换 url 与 companion', () => {
  let frames = applySplit([parent], req(['a', 'b', 'c', 'd', 'e', 'f']), 1, id)!.frames
  const r = applySplit(frames, req(['a', 'g'], ['c']), 50, id)!
  assert.equal(r.frames.filter((f) => f.owner?.purpose === 'split').length, 1)
  assert.deepEqual(r.result.reused, ['a'])
  assert.deepEqual(r.result.replaced, [{ out: 'c', in: 'g' }])
  const sub = r.frames.find((f) => f.owner)!
  const g = sub.nodes.find((x) => x.pane?.kind === 'web' && x.pane.companion?.key === 'g')!
  assert.equal(g.pane?.kind === 'web' && g.pane.url, 'https://g.com')
  assert.equal(sub.nodes.length, 6)
})

test('父 Frame 不存在返回 null', () => {
  assert.equal(applySplit([], req(['x']), 1, id), null)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test src/renderer/src/store/canvas/applySplit.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `applySplit.ts`**

```ts
// 发布分屏落到画布数据上：找 / 建插件拥有的子 Frame，按 planSplit 增 / 复用 / 替换，按 splitLayout 排版。
// 纯函数（不碰 DOM、不调 set），canvasSlice.openSplit 只负责写回 store 与对准镜头。
import type { CanvasFrame, CanvasNode } from './types'
import { planSplit, splitLayout, SPLIT_CELL, type SplitWant } from './splitLayout'
import { HEAD, PAD, GAP } from './geometry'

export interface SplitRequest { pluginId: string; parentFrameId: string; title: string; max: number; cells: SplitWant[]; published: string[] }
export interface SplitResult { frameId: string; opened: string[]; reused: string[]; replaced: Array<{ out: string; in: string }> }

const companionOf = (n: CanvasNode) => (n.pane?.kind === 'web' ? n.pane.companion : undefined)

export function applySplit(frames: readonly CanvasFrame[], req: SplitRequest, now: number, newId: (p: string) => string): { frames: CanvasFrame[]; result: SplitResult } | null {
  const parent = frames.find((f) => f.id === req.parentFrameId)
  if (!parent) return null
  let sub = frames.find((f) => f.parentId === parent.id && f.owner?.pluginId === req.pluginId && f.owner.purpose === 'split')
  const created = !sub
  if (!sub) {
    const nodeBottom = parent.nodes.length ? Math.max(...parent.nodes.map((n) => n.y + n.h)) : HEAD
    const childBottom = frames.filter((c) => c.parentId === parent.id).reduce((m, c) => Math.max(m, c.y - parent.y + (c.collapsed ? HEAD : c.h)), HEAD)
    sub = { id: newId('frame'), projectId: parent.projectId, name: req.title, parentId: parent.id, owner: { pluginId: req.pluginId, purpose: 'split' }, x: parent.x + PAD, y: parent.y + Math.max(nodeBottom, childBottom, HEAD) + GAP, w: 320, h: 140, collapsed: false, nodes: [] }
  }
  const cells = sub.nodes.flatMap((n) => { const c = companionOf(n); return c ? [{ key: c.key, nodeId: n.id, openedAt: c.openedAt }] : [] })
  const plan = planSplit(cells, req.cells, req.published, req.max)
  const toNode = (w: SplitWant, at: number, nodeId: string): CanvasNode => ({ id: nodeId, x: 0, y: 0, w: SPLIT_CELL.w, h: SPLIT_CELL.h, pane: { kind: 'web', url: w.url, companion: { pluginId: req.pluginId, panelId: w.companion.panelId, props: w.companion.props, key: w.key, openedAt: at } } })
  let t = now
  let nodes = sub.nodes.map((n) => {
    const r = plan.replace.find((x) => x.out.nodeId === n.id)
    return r ? toNode(r.in, t++, n.id) : n
  })
  nodes = [...nodes, ...plan.add.map((w) => toNode(w, t++, newId('cnode')))]
  // 格子按 openedAt 排位；非分屏节点（用户自己拖进来的）原样留在后面
  const split = nodes.filter((n) => companionOf(n)).sort((a, b) => companionOf(a)!.openedAt - companionOf(b)!.openedAt)
  const others = nodes.filter((n) => !companionOf(n))
  const lay = splitLayout(split.length)
  const placed = split.map((n, i) => ({ ...n, x: PAD + lay.slots[i].x, y: HEAD + PAD + lay.slots[i].y, w: SPLIT_CELL.w, h: SPLIT_CELL.h }))
  const next: CanvasFrame = { ...sub, name: req.title, nodes: [...placed, ...others], w: Math.max(sub.w, lay.w + 2 * PAD), h: Math.max(HEAD + PAD * 2 + lay.h, 140) }
  const out = created ? [...frames, next] : frames.map((f) => (f.id === next.id ? next : f))
  return { frames: out, result: { frameId: next.id, opened: plan.add.map((w) => w.key), reused: plan.reuse, replaced: plan.replace.map((r) => ({ out: r.out.key, in: r.in.key })) } }
}
```

注：`HEAD / PAD / GAP` 以 `canvasSlice.ts` 现有导入来源为准（`grep -n "HEAD\b.*from" src/renderer/src/store/canvasSlice.ts`）；若它们定义在 `canvasSlice.ts` 本身，先把这三个常量挪到 `store/canvas/geometry.ts` 并改 `canvasSlice.ts` 从那里导入（同一提交）。

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test src/renderer/src/store/canvas/applySplit.test.ts`
Expected: PASS（3 个测试）

- [ ] **Step 5: store 接线**

`store/canvas/types.ts` 的 actions 里加：

```ts
  /** 插件发布分屏（panel/split.open 的落点）。返回 null = 父 Frame 不在了 */
  openSplit: (req: import('./applySplit').SplitRequest) => import('./applySplit').SplitResult | null
  /** 让某个节点的标题栏强调色描边约 1 秒（分屏里点了已打开的平台） */
  flashNode: (nodeId: string) => void
  flashNodeId: string | null
```

`canvasSlice.ts` 初始状态加 `flashNodeId: null`，并实现：

```ts
  openSplit: (req) => {
    const r = applySplit(get().canvas.frames, req, Date.now(), uid)
    if (!r) return null
    set((s) => ({ canvas: { ...s.canvas, frames: reflowFrames(r.frames) } }))
    trackLocal('canvas')
    const f = get().canvas.frames.find((x) => x.id === r.result.frameId)
    if (f) {
      const vp = document.querySelector('.canvas-viewport') as HTMLElement | null
      const vw = vp?.clientWidth ?? window.innerWidth, vh = vp?.clientHeight ?? window.innerHeight
      // 对准整个分屏 Frame 并铺满可视区（留 4% 边），可放大到 1 倍为止
      const scale = Math.min(1, (vw * 0.96) / f.w, (vh * 0.96) / f.h)
      get().setViewport({ x: vw / 2 - (f.x + f.w / 2) * scale, y: vh / 2 - (f.y + f.h / 2) * scale, scale })
    }
    return r.result
  },
  flashNode: (nodeId) => {
    set({ flashNodeId: nodeId })
    setTimeout(() => { if (get().flashNodeId === nodeId) set({ flashNodeId: null }) }, 1000)
  },
```

（`flashNodeId` 若 canvas 状态都在 `canvas` 子对象里，就挂在 slice 顶层，与 `wikiDrawerOpen` 等 UI 态同层；按 `canvasSlice.ts` 现有 UI 态的写法放。）

- [ ] **Step 6: typecheck + 提交**

Run: `npm run -s typecheck`
Expected: 0 退出

```bash
git add src/renderer/src/store/canvas/applySplit.ts src/renderer/src/store/canvas/applySplit.test.ts src/renderer/src/store/canvas/types.ts src/renderer/src/store/canvasSlice.ts src/renderer/src/store/canvas/geometry.ts
git commit -m "feat(canvas): openSplit store action — plugin-owned split frame with replace and fit-to-view"
```

---

### Task 4: 协议、清单权限、能力声明、点击闸门、PluginPanel 处理

**Files:**
- Modify: `src/shared/pluginProtocol.ts`（`VIEW_REQUESTS` 加 `'panel/split.open'`）
- Modify: `src/shared/panelHostActions.ts`（`splitRequestOf`）
- Test: `src/shared/panelHostActions.test.ts`（追加；文件不存在则新建）
- Modify: `src/shared/types.ts:818`（`permissions.split?: boolean`）
- Modify: `src/main/pluginManifest.ts:216`（解析 `permissions.split`）
- Test: `src/main/pluginManifest.test.ts`（追加）
- Modify: `src/renderer/src/features/plugins/appsProtocol.ts`（`experimental.eas.split`、`PanelCtx.params`）
- Modify: `src/renderer/src/features/plugins/PluginPanel.tsx`（处理 `panel/split.open`）

**Interfaces:**
- Consumes: `openSplit`, `flashNode` (Task 3)；`SplitWant` (Task 1)
- Produces:
  - `export function splitRequestOf(params: unknown, manifestPanels: readonly string[]): ActionCheck<{ title: string; max: number; cells: SplitWant[]; published: string[] }>`
  - `PluginInfo.permissions.split?: boolean`
  - `hostCapabilities.experimental.eas.split = {}`（始终声明，权限由清单决定）
  - `PanelCtx.params?: Record<string, unknown>`（只进 `ui/initialize` 的 `hostContext._meta.eas.context`，不发给主进程）

- [ ] **Step 1: 写失败的测试**

`src/shared/panelHostActions.test.ts` 追加：

```ts
import { splitRequestOf } from './panelHostActions.ts'

test('split.open：合法请求通过，max 夹到 6', () => {
  const r = splitRequestOf({ title: '发布分屏', max: 99, cells: [{ key: 'x', url: 'https://x.com/compose', companion: { panelId: 'cell', props: { platform: 'x' } } }], published: [] }, ['main', 'cell'])
  assert.ok(r.ok); assert.equal(r.ok && r.value.max, 6)
})
test('split.open：非 http(s)、面板不在清单、cells 为空都拒', () => {
  const cell = (url: string, panelId = 'cell') => ({ key: 'k', url, companion: { panelId, props: {} } })
  assert.equal(splitRequestOf({ title: 't', max: 6, cells: [cell('file:///etc/passwd')], published: [] }, ['cell']).ok, false)
  assert.equal(splitRequestOf({ title: 't', max: 6, cells: [cell('https://a.com', 'evil')], published: [] }, ['cell']).ok, false)
  assert.equal(splitRequestOf({ title: 't', max: 6, cells: [], published: [] }, ['cell']).ok, false)
})
test('split.open：props 序列化超过 2KB 拒（只放身份，不放内容）', () => {
  const big = { key: 'k', url: 'https://a.com', companion: { panelId: 'cell', props: { x: 'a'.repeat(3000) } } }
  assert.equal(splitRequestOf({ title: 't', max: 6, cells: [big], published: [] }, ['cell']).ok, false)
})
```

`src/main/pluginManifest.test.ts` 追加（照该文件已有的 `parseManifest` 调用写法）：

```ts
test('permissions.split 只认 true', () => {
  const base = { name: 'p', version: '1.0.0', displayName: 'P', mcp: { command: 'node', args: ['s.mjs'] } }
  assert.equal(parseManifest({ ...base, permissions: { split: true } }).info?.permissions?.split, true)
  assert.equal(parseManifest({ ...base, permissions: { split: 'yes' } }).info?.permissions?.split, undefined)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test src/shared/panelHostActions.test.ts src/main/pluginManifest.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现**

`panelHostActions.ts` 追加：

```ts
import type { SplitWant } from './splitView'

/** panel/split.open（2026-10-02 发布台分屏）：把发布页放进画布上的分屏子 Frame。闸门同上（真实点击），这里只做内容判定 */
export function splitRequestOf(params: unknown, manifestPanels: readonly string[]): ActionCheck<{ title: string; max: number; cells: SplitWant[]; published: string[] }> {
  const p = (params ?? {}) as Record<string, unknown>
  const title = typeof p.title === 'string' ? p.title.slice(0, 80) : ''
  if (!title) return { ok: false, error: '缺少分屏标题' }
  const raw = Array.isArray(p.cells) ? p.cells.slice(0, 6) : []
  if (!raw.length) return { ok: false, error: '没有要放进分屏的页面' }
  const cells: SplitWant[] = []
  for (const c of raw as Array<Record<string, unknown>>) {
    const key = typeof c?.key === 'string' ? c.key.slice(0, 40) : ''
    const url = typeof c?.url === 'string' ? c.url : ''
    const comp = (c?.companion ?? {}) as { panelId?: unknown; props?: unknown }
    if (!key || !/^https?:\/\//.test(url) || url.length > 2048) return { ok: false, error: '只能放 http(s) 页面' }
    if (typeof comp.panelId !== 'string' || !manifestPanels.includes(comp.panelId)) return { ok: false, error: '头条面板不在插件清单里' }
    const props = comp.props && typeof comp.props === 'object' && !Array.isArray(comp.props) ? (comp.props as Record<string, unknown>) : {}
    if (JSON.stringify(props).length > 2048) return { ok: false, error: '头条参数过大' }
    cells.push({ key, url, companion: { panelId: comp.panelId, props } })
  }
  const max = Math.max(1, Math.min(6, Math.floor(Number(p.max)) || 6))
  const published = Array.isArray(p.published) ? p.published.filter((x): x is string => typeof x === 'string').slice(0, 64) : []
  return { ok: true, value: { title, max, cells, published } }
}
```

`pluginProtocol.ts`：`VIEW_REQUESTS` 末尾 `'panel/reveal'` 后加 `'panel/split.open'`。

`shared/types.ts:818`：`permissions?: { canvas?: string[]; events?: string[]; split?: boolean }`。

`pluginManifest.ts:216` 的 `permissions:` 对象里加：`...(rec(m.permissions)?.split === true ? { split: true } : {})`。

`appsProtocol.ts`：
- `PanelCtx` 加 `params?: Record<string, unknown>`；
- `experimental: { eas: { canvasCall: ..., panelResize: {}, split: {} } }`。

`PluginPanel.tsx`：
- 组件参数加 `embedded?: { params: Record<string, unknown> }`；`panelCtx` 构造处加 `...(embedded ? { params: embedded.params } : {})`；
- `case 'panel/split.open':` 放在 `case 'panel/reveal'` 块之后：

```tsx
        case 'panel/split.open': {
          // 2026-10-02 发布台分屏：同 clipboard.write 的闸门（本地插件 + 焦点 + 真实点击），再要清单 permissions.split
          const focused = document.activeElement === f
          const activated = navigator.userActivation?.isActive === true
          let plugin: PluginInfo | undefined
          try { plugin = (await window.api.plugins.list()).find((item) => item.id === pluginId) } catch { plugin = undefined }
          const gate = hostActionAllowed({ remote: plugin ? !!plugin.remote : null, focused, activated })
          if (!gate.ok) { post(errorResponse(r.id, -32603, gate.error)); return }
          if (plugin?.permissions?.split !== true || popup || embedded) { post(errorResponse(r.id, -32603, '这个插件没有分屏权限')); return }
          const req = splitRequestOf(r.params, (plugin.panels ?? []).map((x) => x.id))
          if (!req.ok) { post(errorResponse(r.id, -32602, req.error)); return }
          const st = useStore.getState()
          const res = st.openSplit({ pluginId: plugin.id, parentFrameId: ctx.frameId, ...req.value })
          if (!res) { post(errorResponse(r.id, -32603, '面板所在的 Frame 不在了')); return }
          if (!res.opened.length && !res.replaced.length && res.reused.length) {
            const frame = useStore.getState().canvas.frames.find((x) => x.id === res.frameId)
            const node = frame?.nodes.find((n) => n.pane?.kind === 'web' && n.pane.companion?.key === res.reused[0])
            if (frame && node) { st.focusCanvasNode(frame.id, node.id, { fit: true }); st.flashNode(node.id) }
          }
          post(resultResponse(r.id, { opened: res.opened, reused: res.reused, replaced: res.replaced }))
          return
        }
```

（`PluginInfo` 若未导入，从 `../../../../shared/types` 加 `type PluginInfo`；`splitRequestOf` 从 `../../../../shared/panelHostActions` 导入。）

- [ ] **Step 4: 跑测试 + typecheck**

Run: `node --test src/shared/panelHostActions.test.ts src/main/pluginManifest.test.ts src/renderer/src/features/plugins/appsProtocol.test.ts && npm run -s typecheck`
Expected: PASS；`appsProtocol.test.ts` 若断言了 `experimental.eas` 的完整对象，更新断言加上 `split: {}`。

- [ ] **Step 5: 提交**

```bash
git add src/shared/pluginProtocol.ts src/shared/panelHostActions.ts src/shared/panelHostActions.test.ts src/shared/types.ts src/main/pluginManifest.ts src/main/pluginManifest.test.ts src/renderer/src/features/plugins/appsProtocol.ts src/renderer/src/features/plugins/appsProtocol.test.ts src/renderer/src/features/plugins/PluginPanel.tsx
git commit -m "feat(plugins): panel/split.open host action behind the click gate and permissions.split"
```

---

### Task 5: 网页节点渲染头条 + 闪一下

**Files:**
- Modify: `src/renderer/src/features/canvas/CanvasFileNode.tsx:323-331`
- Modify: `src/renderer/src/features/plugins/PluginPanel.tsx`（`embedded` 模式不画外框、不响应 `eas/panel.resize`）
- Modify: `src/renderer/src/features/canvas/canvas.css`（`.cfile-companion`、`.cfile.flash`）
- Test: `src/renderer/src/features/canvas/companionWiring.test.mjs`（源码级断言，同仓库 `canvasDragWiring.test.mjs` 写法）

**Interfaces:**
- Consumes: `WebCompanion` (Task 2)；`flashNodeId` (Task 3)；`PluginPanel` 的 `embedded` (Task 4)

- [ ] **Step 1: 写失败的测试**

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
const node = fs.readFileSync(new URL('./CanvasFileNode.tsx', import.meta.url), 'utf8')
const panel = fs.readFileSync(new URL('../plugins/PluginPanel.tsx', import.meta.url), 'utf8')
test('带 companion 的网页节点在网页上方渲染插件面板（embedded）', () => {
  assert.match(node, /pane\.companion/)
  assert.match(node, /<PluginPanel[\s\S]{0,200}embedded=/)
  assert.match(node, /className="cfile-companion"/)
})
test('embedded 面板不改节点尺寸', () => {
  const resize = panel.slice(panel.indexOf("case 'eas/panel.resize'"), panel.indexOf("case 'eas/panel.resize'") + 400)
  assert.match(resize, /embedded/)
})
test('flashNodeId 命中时节点加 flash 类', () => {
  assert.match(node, /flashNodeId === node\.id/)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test src/renderer/src/features/canvas/companionWiring.test.mjs`
Expected: FAIL

- [ ] **Step 3: 实现**

`CanvasFileNode.tsx` 的 web 分支改成：

```tsx
        {pane.kind === 'web' && !reportPreviewActive && (
          <div className="cfile-web-stack">
            {pane.companion && (
              <div className="cfile-companion">
                <PluginPanel
                  ctx={{ nodeId: node.id, frameId, projectId, cwd, props: { pluginId: pane.companion.pluginId, panelId: pane.companion.panelId } }}
                  embedded={{ params: pane.companion.props }}
                />
              </div>
            )}
            <WebView key={revision}
              url={pane.url}
              frameId={frameId}
              nodeId={node.id}
              selected={selected}
              zoom={isMax ? maxScale : 1} onZoomChange={isMax ? setMaxScale : undefined}
            />
          </div>
        )}
```

（`projectId`、`cwd` 取该组件里已有的同名值；没有就用 `useStore` 按 `frameId` 找 Frame 的 `projectId` 与项目路径，照 `CanvasComponentNode.tsx` 给 `PluginPanel` 传 ctx 的写法。）

节点根元素 className 追加 `${flashNodeId === node.id ? ' flash' : ''}`，`flashNodeId` 用 `useStore((s) => s.flashNodeId)` 取。

`PluginPanel.tsx`：`embedded` 时根元素加类 `plg-embedded`，不渲染标题与重开按钮；`case 'eas/panel.resize'` 开头加 `if (embedded) { post(resultResponse(r.id, { w: 0, h: 44 })); return }`。

`canvas.css` 追加（令牌按 15 图纸，不写死色值）：

```css
/* 发布分屏格子：网页上方的插件头条（2026-10-02） */
.cfile-web-stack { display: flex; flex-direction: column; width: 100%; height: 100%; min-height: 0; }
.cfile-web-stack > .web-body, .cfile-web-stack > webview { flex: 1; min-height: 0; }
.cfile-companion { flex: none; height: 44px; overflow: hidden; background: var(--s-2); }
.cfile-companion .plg-embedded, .cfile-companion iframe { width: 100%; height: 44px; border: 0; }
.cfile.flash .cfile-head { box-shadow: inset 0 0 0 1px var(--accent); transition: box-shadow 150ms cubic-bezier(.4,0,.2,1); }
```

（`.cfile-head` 换成该节点标题栏实际类名：`grep -n "className=\"cfile-" src/renderer/src/features/canvas/CanvasFileNode.tsx`。）

- [ ] **Step 4: 测试 + typecheck + 构建**

Run: `node --test src/renderer/src/features/canvas/companionWiring.test.mjs && npm run -s typecheck && npx electron-vite build`
Expected: 全部通过

- [ ] **Step 5: 提交**

```bash
git add src/renderer/src/features/canvas/CanvasFileNode.tsx src/renderer/src/features/plugins/PluginPanel.tsx src/renderer/src/features/canvas/canvas.css src/renderer/src/features/canvas/companionWiring.test.mjs
git commit -m "feat(canvas): web nodes render a plugin companion strip above the page; flash on reuse"
```

---

### Task 6: 插件 —— 挑选规则、`cell` 面板、主面板按钮与降级

**Files:**
- Create: `resources/plugins/publish-desk/lib/split.mjs`
- Test: `resources/plugins/publish-desk/lib/split.test.ts`
- Create: `resources/plugins/publish-desk/ui/cell.html`
- Modify: `resources/plugins/publish-desk/plugin.json`（`cell` 面板、`permissions.split`、0.1.2）
- Modify: `resources/plugins/publish-desk/server.mjs`（`VERSION`、`resources/list|read` 支持 `ui://publish-desk/cell`）
- Modify: `resources/plugins/publish-desk/ui/panel.html`（「分屏打开」、卡片按钮、降级）

**Interfaces:**
- Produces: `export function pickForSplit(cards, filter, max = 6)` → `card[]`；`cell` 面板读 `hostContext._meta.eas.context.params = { batchId, platform }`

- [ ] **Step 1: 写失败的测试**

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pickForSplit } from './split.mjs'

const card = (platform: string, o: Record<string, unknown> = {}) => ({ platform, title: 't', body: 'b', tags: [], media: [], status: 'draft', p1: false, ...o })
test('有文案、没发、没标不发，最多 6 个，按卡片顺序', () => {
  const cards = [card('a'), card('b', { status: 'published' }), card('c', { status: 'skipped' }), card('d', { title: '', body: '' }), card('e'), card('f'), card('g'), card('h'), card('i'), card('j')]
  assert.deepEqual(pickForSplit(cards, 'all').map((c) => c.platform), ['a', 'e', 'f', 'g', 'h', 'i'])
})
test('首批三个筛选：只取 p1', () => {
  assert.deepEqual(pickForSplit([card('a'), card('b', { p1: true })], 'p1').map((c) => c.platform), ['b'])
})
test('只有标签或素材也算有内容', () => {
  assert.deepEqual(pickForSplit([card('a', { title: '', body: '', tags: ['x'] })], 'todo').map((c) => c.platform), ['a'])
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test resources/plugins/publish-desk/lib/split.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 `lib/split.mjs`**

```js
// 「分屏打开」挑哪几张卡：当前筛选下、有内容、没发、没标「不发」，按卡片顺序取前 max 个（宿主分屏最多 6 格）
const hasContent = (c) => !!(c.title || c.body || c.tags?.length || c.media?.length)
export function pickForSplit(cards, filter, max = 6) {
  const inFilter = (c) => (filter === 'p1' ? c.p1 : true)
  return cards.filter((c) => inFilter(c) && hasContent(c) && c.status !== 'published' && c.status !== 'skipped').slice(0, max)
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test resources/plugins/publish-desk/lib/split.test.ts`
Expected: PASS

- [ ] **Step 5: 清单与 server**

`plugin.json`：`"version": "0.1.2"`；`panels` 追加 `{ "id": "cell", "title": "发布台 · 格子", "tool": "desk_list", "entry": "ui://publish-desk/cell", "defaultSize": { "w": 420, "h": 44 } }`；`permissions` 改为 `{ "canvas": [], "split": true }`。

`server.mjs`：`VERSION = '0.1.2'`；`resources/list` 返回两项（panel、cell）；`resources/read` 按 `uri` 选 `ui/panel.html` 或 `ui/cell.html`，其他 uri 抛「未知资源」。

- [ ] **Step 6: `ui/cell.html`**

单文件面板，令牌与 `panel.html` 顶部相同的暗 / 亮两套变量；高 44px 一行：平台标识（复用 panel.html 的 `ICONS` 与 `logo()`——把这两段抽到 `ui/icons.js` 不可行，因为面板是单文件 HTML；直接复制 `ICONS` 常量与 `logo()` 函数，并在两个文件顶部注释「与 cell.html / panel.html 同步，改一处改两处」）+ 名字 + `复制标题` `复制正文` `复制标签` `标记已发布`。逻辑：
- `ui/initialize` 后从 `init.hostContext._meta.eas.context.params` 取 `{ batchId, platform }`；
- `refresh()`：`tool('desk_list', { batchId })` 找到该平台卡片，按有无标题 / 标签决定按钮显隐；已发布显示「已发布」态；
- 复制：`rpc('panel/clipboard.write', { text })` 后按钮文字闪「已复制」1.5s；
- 标记已发布：同 panel.html 的「填链接（可不填）→ 确认」，但只占一行（输入框 + 确认 + 取消替换按钮区）；`tool('desk_mark', { batchId, platform, status: 'published', url })`；
- 监听 `notifications/resources/updated` 与 `ui/notifications/tool-result` → `refresh()`；监听 `host-context-changed` 换主题。

- [ ] **Step 7: 主面板 `panel.html`**

- `ui/initialize` 结果里存 `const canSplit = !!init?.hostCapabilities?.experimental?.eas?.split`；
- 筛选行右侧加 `<button class="primary" id="split-open">分屏打开</button>`，`canSplit` 为假时不渲染；按 `pickForSplit(batch.cards, filter)` 结果为空时 `disabled` 并 `title="当前筛选下没有要发的平台"`（`pickForSplit` 在 panel.html 内联同样实现，注释指向 `lib/split.mjs` 并说明两处同步）；
- `openSplit(cards)`：

```js
async function openSplit(cards){
  const r = await rpc('panel/split.open', { title: '发布分屏 · ' + batch.title, max: 6,
    cells: cards.map(c => ({ key: c.platform, url: c.url, companion: { panelId: 'cell', props: { batchId, platform: c.platform } } })),
    published: batch.cards.filter(c => c.status === 'published').map(c => c.platform) })
  const name = p => batch.cards.find(c => c.platform === p)?.name || p
  if (r.replaced?.length) status(`分屏已满，已替换 ${r.replaced.map(x => name(x.out)).join('、')} 的格子`)
  else if (r.opened?.length) status(`已在分屏打开 ${r.opened.map(name).join('、')}`)
  else if (r.reused?.length) status(`${r.reused.map(name).join('、')}已在分屏中`)
}
```

- 点击：`#split-open` → `openSplit(pickForSplit(batch.cards, filter))`；卡片 `data-open` → `canSplit ? openSplit([card]) : 原来的 ui/open-link`。**两者都必须在 click 事件处理里同步发起 rpc**（宿主按真实点击放行）。

- [ ] **Step 8: 插件测试 + 提交**

Run: `node --test resources/plugins/publish-desk/lib/*.test.ts`
Expected: 全部 PASS

```bash
git add resources/plugins/publish-desk
git commit -m "feat(publish-desk): split view — pick rule, cell strip panel, 'Open in split' button with fallback (0.1.2)"
```

---

### Task 7: 真机验收脚本 + 图纸 + 全量检查

**Files:**
- Create: `scripts/verify-publish-desk-split.mjs`
- Modify: `docs/architecture/10a-领地明细-渲染层.md`、`docs/architecture/10d-专题记录.md`、`docs/architecture/11-MCP工具网络.md`、`docs/architecture/03b-补充护栏详情.md`、`docs/architecture/03-agent角色边界.md`（索引一行）
- Modify: `docs/superpowers/specs/2026-10-02-发布台分屏-design.md`（补「分屏格子不计入内容上限」一条）

- [ ] **Step 1: 验收脚本**

以 `scripts/verify-publish-desk-live.mjs` 为底（隔离 profile / HOME、`deskCall` 外部写数据、连 `eas-plugin://` 面板 target），新增：
1. 写入一批 8 张有文案的卡片（含 1 张 skipped、1 张 published）；
2. 在主面板 target 上用 `Input.dispatchMouseEvent` 真实点击 `#split-open`（坐标 = iframe 在主页面的 rect + 按钮在 iframe 内的 rect），断言：store 里出现 `owner.purpose==='split'` 的子 Frame，格子数 = `min(6, 可发数)`，`frameId` 对应的 Frame 在视口内铺满（`viewport.scale` 与 Frame 尺寸算出的值一致）；
3. 再真实点击一张已在分屏里的卡片的「打开发布页」：格子数不变，`flashNodeId` 等于那格；
4. 把一格标已发布后点一张不在分屏里的卡片：被换掉的是已发布那格，主面板状态栏含「已替换」；
5. 连到某格的 `cell` 面板 target，真实点击「复制标题」：`clipboard.readText()`（主进程 CDP）等于卡片标题；
6. 真实点击该格「标记已发布 → 确认」：主面板该卡片变已发布；
7. 删除主面板节点后，`cell` 面板仍可复制；
8. 杀进程重启同一 profile：分屏 Frame 与 6 格的 companion 仍在；
9. 用 `EAS_SPLIT_DISABLED=1` 启动（`appsProtocol.ts` 读这个环境变量时不声明 `split`，仅验收用）：`#split-open` 不存在，卡片按钮走 `ui/open-link`；
10. 暗 / 亮各截图到 `docs/verification/publish-desk-split/`。

（第 9 条要在 Task 4 的 `appsProtocol.ts` 里加：`...(window.api.app?.env?.EAS_SPLIT_DISABLED === '1' ? {} : { split: {} })`；若渲染层读不到环境变量，改为读 `localStorage.getItem('eas:verify:no-split') === '1'`，脚本在启动后设置再刷新面板。）

- [ ] **Step 2: 跑验收直到通过**

Run: `npx electron-vite build && node scripts/verify-publish-desk-split.mjs`
Expected: `PASS`，截图与 `result.json` 落盘。

- [ ] **Step 3: 图纸**

- 10a：网页节点「companion 头条」与 `openSplit`；
- 10d：「2026-10-02 发布台分屏」一节（结构、替换规则、不计内容上限、旧宿主降级、验收脚本）；
- 11：新宿主动作 `panel/split.open`（闸门、权限、参数、返回）；
- 03b：护栏「`panel/split.open` 只在真实点击时放行，别开批量 / 定时口子；分屏格子不计内容上限」，03 补充护栏索引加一行；
- spec 补「分屏格子不计入内容上限」。

- [ ] **Step 4: 全量检查**

Run: `npm run check`
Expected: 0 失败（`check-arch-size` 通过）

- [ ] **Step 5: 提交**

```bash
git add scripts/verify-publish-desk-split.mjs docs/
git commit -m "test(publish-desk): real-app split view verification; architecture notes"
```
