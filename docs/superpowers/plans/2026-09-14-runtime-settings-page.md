# 运行中心收进设置 · 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把运行中心从右侧贴边对话框改成设置里的「系统管理 › 运行与资源」一页；标题栏拆掉 MCP 灯与运行按钮，只留一个有事才出现的临时提示；托管服务改成项目卡片 + 芯片、默认折叠；芯片面板里能「定位」到画布模块。

**Architecture:** 主进程只加一条「调度器队列变了」的推送（`runtime:waiting`），其余动作沿用现有 IPC。渲染层新建 `RuntimeSettingsPage`（页）、`RuntimeServiceCards`（卡片 + 芯片 + 弹出）、`TitlebarAlert`（临时提示）三个组件与一个纯函数模块 `runtimeView.ts`（分组 / 摘要 / 标签 / 服务 id 解析），删除 `RuntimeCenter.tsx`、`RuntimeMonitorPanel.tsx`、`runtimeCenter.css`，`McpIndicator.tsx` 只留 `McpBody`。定位纯渲染层实现：服务 id ↔ leaf pane 的 `ptyId` / `sessionId`。

**Tech Stack:** Electron 37 · React 18 · zustand store · `node --test`（纯逻辑）· CDP 隔离实例（UI 验收，`node scripts/verify-app.mjs --seed` + `scripts/eval-in-app.mjs`）

**Spec:** `docs/superpowers/specs/2026-09-14-runtime-settings-page-design.md`（视觉稿 `docs/prototype/2026-09-14-runtime-center.html`）

## Global Constraints

- 工作树：`.worktrees/voice-regression`，分支 `fix/background-render-budget`（0.4.96 已从这里发）。
- 颜色 / 间距只用 `styles/base.css` 的令牌，不写死值（图纸 15）；状态色必须带文字。
- 主进程所有权与确认框逻辑（`runtime/ipc.ts` 的 `runtime:stopPlugin` / `runtime:cancelTask`）一字不动。
- 黑匣子「空闲零开销」：渲染层不新增常驻轮询；读数轮询只在 `runtime` 页打开时跑。
- 改了代码要同步图纸 `docs/architecture/10-模块领地图.md`，同一个 commit。
- 每个 Task 结束：`npm run typecheck` 0 错；纯逻辑 `node --test <文件>` 绿；最后一个 Task 跑 `npm test` 全量与 CDP 验收。
- 提交信息末尾带 `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`。

---

### Task 1: 纯函数 `runtimeView.ts`（分组 / 摘要 / 标签 / 服务 id 解析）

**Files:**
- Create: `src/renderer/src/features/workspace/runtimeView.ts`
- Test: `src/renderer/src/features/workspace/runtimeView.test.ts`

**Interfaces:**
- Consumes: `RuntimeObservedService`、`RuntimeRecentItem` from `src/shared/runtimeResources.ts`
- Produces（后面 Task 4/5/6 直接用）:
  - `KIND_LABEL: Record<RuntimeObservedService['kind'], string>`
  - `OUTCOME_LABEL: Record<RuntimeRecentItem['outcome'], string>`
  - `queueReasonLabel(reason?: string): string`
  - `matchProject(filter: string, ids: readonly (string | null)[]): boolean` —— `''` 全部，`'none'` 仅未关联
  - `groupServices(services, mode, labelOf): { key: string; title: string; items: RuntimeObservedService[] }[]`
  - `servicesSummary(services): { kinds: { kind; label; count }[]; stopping: number }`
  - `serviceLeafRef(id): { kind: 'terminal'; ptyId: string } | { kind: 'agent'; sessionId: string } | null`
  - `fmtDuration(ms: number): string`、`fmtAgo(ms: number): string`

- [ ] **Step 1: 写失败的测试**

```ts
// src/renderer/src/features/workspace/runtimeView.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { groupServices, matchProject, queueReasonLabel, serviceLeafRef, servicesSummary, fmtDuration, fmtAgo, KIND_LABEL } from './runtimeView.ts'
import type { RuntimeObservedService } from '../../../../shared/runtimeResources.ts'

const svc = (id: string, kind: RuntimeObservedService['kind'], projectIds: string[], extra: Partial<RuntimeObservedService> = {}): RuntimeObservedService =>
  ({ id, name: KIND_LABEL[kind], kind, projectIds, unknownRefs: 0, uptimeMs: 60_000, state: 'running', canStop: true, ...extra })

test('按项目分组：同项目归一张卡，未关联单独一张，顺序按首次出现', () => {
  const list = [svc('pty:1', 'terminal', ['a']), svc('agent:ac-1:1', 'agent', ['b']), svc('pty:2', 'terminal', ['a']), svc('plugin:x', 'plugin', [])]
  const g = groupServices(list, 'project', (id) => ({ a: '桌面整理', b: 'AI竞技场' })[id] ?? id)
  assert.deepEqual(g.map((x) => [x.title, x.items.map((s) => s.id)]), [['桌面整理', ['pty:1', 'pty:2']], ['AI竞技场', ['agent:ac-1:1']], ['未关联', ['plugin:x']]])
})

test('按类型分组：标题用类型中文名', () => {
  const list = [svc('pty:1', 'terminal', ['a']), svc('lsp:ts', 'language-server', ['a'])]
  assert.deepEqual(groupServices(list, 'kind', (id) => id).map((x) => x.title), ['终端', '语言服务器'])
})

test('跨窗口共享的服务可能归属多个项目：每个项目的卡都出现', () => {
  const list = [svc('lsp:ts', 'language-server', ['a', 'b'])]
  const g = groupServices(list, 'project', (id) => id)
  assert.deepEqual(g.map((x) => x.title), ['a', 'b'])
})

test('摘要：按类型计数，并数出停止中的', () => {
  const list = [svc('pty:1', 'terminal', ['a']), svc('pty:2', 'terminal', ['a']), svc('agent:ac-1:1', 'agent', ['a'], { state: 'stopping', canStop: false })]
  assert.deepEqual(servicesSummary(list), { kinds: [{ kind: 'terminal', label: '终端', count: 2 }, { kind: 'agent', label: 'AI 对话', count: 1 }], stopping: 1 })
})

test('项目筛选：空 = 全部，none = 只要未关联', () => {
  assert.equal(matchProject('', ['a']), true)
  assert.equal(matchProject('a', ['a', 'b']), true)
  assert.equal(matchProject('a', ['b']), false)
  assert.equal(matchProject('none', [null]), true)
  assert.equal(matchProject('none', ['a', null]), false)
})

test('排队原因翻译，未知原因给通用说法', () => {
  assert.equal(queueReasonLabel('memory-threshold'), '内存超过当前阈值')
  assert.equal(queueReasonLabel('critical-pressure'), '系统内存压力过高')
  assert.equal(queueReasonLabel('whatever'), '等待运行名额或资源预算')
  assert.equal(queueReasonLabel(undefined), '等待运行名额或资源预算')
})

test('服务 id 解析：pty 与 agent 能对回 leaf，其它为 null', () => {
  assert.deepEqual(serviceLeafRef('pty:17'), { kind: 'terminal', ptyId: '17' })
  assert.deepEqual(serviceLeafRef('agent:ac-3:2'), { kind: 'agent', sessionId: 'ac-3' })
  assert.equal(serviceLeafRef('lsp:typescript'), null)
  assert.equal(serviceLeafRef('agent:'), null)
  assert.equal(serviceLeafRef('pty:'), null)
})

test('时长与相对时间：秒以下不显示、分钟与小时分档', () => {
  assert.equal(fmtDuration(900), '不到 1 秒')
  assert.equal(fmtDuration(12_000), '12 秒')
  assert.equal(fmtDuration(7 * 60_000 + 5000), '7 分钟')
  assert.equal(fmtDuration(3 * 3600_000 + 12 * 60_000), '3 小时 12 分')
  assert.equal(fmtAgo(2 * 60_000), '2 分钟前')
  assert.equal(fmtAgo(30_000), '30 秒前')
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd .worktrees/voice-regression && node --test src/renderer/src/features/workspace/runtimeView.test.ts`
Expected: 报 `Cannot find module './runtimeView.ts'`

- [ ] **Step 3: 实现**

```ts
// src/renderer/src/features/workspace/runtimeView.ts
// 「运行与资源」页的纯函数：分组、摘要、标签、服务 id 解析。不 import React / store，`node --test` 裸跑。
import type { RuntimeObservedService, RuntimeRecentItem } from '../../../../shared/runtimeResources'

export const KIND_LABEL: Record<RuntimeObservedService['kind'], string> = {
  terminal: '终端', agent: 'AI 对话', plugin: '插件', 'language-server': '语言服务器', voice: '语音', cli: 'CLI'
}
export const OUTCOME_LABEL: Record<RuntimeRecentItem['outcome'], string> = {
  done: '完成', cancelled: '已取消', timeout: '排队超时', failed: '失败', exited: '已退出'
}
const REASON: Record<string, string> = {
  'memory-threshold': '内存超过当前阈值', 'cpu-threshold': 'CPU超过当前阈值', 'metrics-unavailable': '等待可靠资源采样',
  recovering: '等待资源持续恢复', 'critical-pressure': '系统内存压力过高'
}
export function queueReasonLabel(reason?: string): string {
  return (reason && REASON[reason]) || '等待运行名额或资源预算'
}
/** '' = 全部；'none' = 只要完全未关联的 */
export function matchProject(filter: string, ids: readonly (string | null)[]): boolean {
  if (filter === '') return true
  if (filter === 'none') return ids.every((id) => id === null)
  return ids.includes(filter)
}
export interface ServiceGroup { key: string; title: string; items: RuntimeObservedService[] }
/** 按项目：一个服务归属几个项目就出现在几张卡里（共享语言服务器）；没有归属进「未关联」。按类型：标题用中文类型名。 */
export function groupServices(services: readonly RuntimeObservedService[], mode: 'project' | 'kind', labelOf: (projectId: string) => string): ServiceGroup[] {
  const groups = new Map<string, ServiceGroup>()
  const put = (key: string, title: string, s: RuntimeObservedService): void => {
    let g = groups.get(key)
    if (!g) { g = { key, title, items: [] }; groups.set(key, g) }
    g.items.push(s)
  }
  for (const s of services) {
    if (mode === 'kind') { put('kind:' + s.kind, KIND_LABEL[s.kind], s); continue }
    if (!s.projectIds.length) { put('project:none', '未关联', s); continue }
    for (const id of s.projectIds) put('project:' + id, labelOf(id), s)
  }
  return [...groups.values()]
}
export function servicesSummary(services: readonly RuntimeObservedService[]): { kinds: { kind: RuntimeObservedService['kind']; label: string; count: number }[]; stopping: number } {
  const counts = new Map<RuntimeObservedService['kind'], number>()
  let stopping = 0
  for (const s of services) {
    counts.set(s.kind, (counts.get(s.kind) ?? 0) + 1)
    if (s.state === 'stopping') stopping += 1
  }
  return { kinds: [...counts.entries()].map(([kind, count]) => ({ kind, label: KIND_LABEL[kind], count })), stopping }
}
/** 服务 id → 画布上对应 leaf 的钥匙。id 形状由主进程定：pty.ts 的 'pty:<id>'，session.ts 的 'agent:<sessionId>:<generation>' */
export function serviceLeafRef(id: string): { kind: 'terminal'; ptyId: string } | { kind: 'agent'; sessionId: string } | null {
  const pty = id.match(/^pty:(.+)$/)
  if (pty) return { kind: 'terminal', ptyId: pty[1] }
  const agent = id.match(/^agent:([^:]+):\d+$/)
  if (agent) return { kind: 'agent', sessionId: agent[1] }
  return null
}
export function fmtDuration(ms: number): string {
  if (ms < 1000) return '不到 1 秒'
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s} 秒`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} 分钟`
  return `${Math.floor(m / 60)} 小时 ${m % 60} 分`
}
export function fmtAgo(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s} 秒前`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} 分钟前`
  return `${Math.floor(m / 60)} 小时前`
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test src/renderer/src/features/workspace/runtimeView.test.ts`
Expected: `pass 8` `fail 0`

- [ ] **Step 5: 提交**

```bash
git add src/renderer/src/features/workspace/runtimeView.ts src/renderer/src/features/workspace/runtimeView.test.ts
git commit -m "feat(runtime): 运行与资源页的纯函数——分组 / 摘要 / 标签 / 服务 id 解析"
```

---

### Task 2: 调度器变化推送 `runtime:waiting`（主进程 → 渲染层）

**Files:**
- Modify: `src/main/runtime/scheduler.ts`（`Options` 加 `onChange`，五处状态变化后调用）
- Modify: `src/main/runtime/manager.ts:10`（`opts.onChange` 透传给 `createScheduler`）
- Modify: `src/main/runtime/controller.ts:11-12`（`deps.onQueueChange` 透传给 manager）
- Modify: `src/main/runtime/ipc.ts:38`（创建 controller 时传 `onQueueChange`，广播 + `runtime:waiting` invoke）
- Modify: `src/preload/index.ts:1109-1112`（加 `runtimeWaiting` / `onRuntimeWaiting`）
- Test: `src/main/runtime/scheduler.test.ts`（追加一条）

**Interfaces:**
- Produces: preload `window.api.runtimeWaiting(): Promise<{ queued: number }>`；`window.api.onRuntimeWaiting(cb: (d: { queued: number }) => void): () => void`

- [ ] **Step 1: 写失败的测试（追加到 scheduler.test.ts 末尾）**

```ts
test('onChange：入队、开跑、结束、取消各触发一次，最后一次的 snapshot 队列为空', async () => {
  let calls = 0
  const s = createScheduler({ now: () => 0, allow: () => true, maxRunning: 1, maxQueued: 4, onChange: () => { calls++ } })
  let finish!: () => void
  const p1 = s.submit({ id: 'a', projectId: 'p', run: () => new Promise<void>((r) => { finish = r }) })
  const p2 = s.submit({ id: 'b', projectId: 'p', run: async () => {} })
  assert.equal(s.snapshot().queued, 1)          // a 在跑，b 排队
  assert.ok(calls >= 3)                          // a 入队、a 开跑、b 入队
  const before = calls
  s.cancel('b'); await p2.catch(() => {})
  assert.ok(calls > before)                      // 取消也算变化
  finish(); await p1
  assert.equal(s.snapshot().queued, 0); assert.equal(s.snapshot().running, 0)
})
```

（`createScheduler` 的 import 与现有测试相同。）

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test src/main/runtime/scheduler.test.ts`
Expected: 类型/运行时报 `onChange` 未定义或 `calls` 为 0 → FAIL

- [ ] **Step 3: 实现**

`scheduler.ts` 的 `Options` 加一行：

```ts
 /** 队列 / 运行集合任何变化后调用（入队、开跑、结束、拒绝、取消、dispose）。给标题栏「等待 N」用；不传就不调。 */
 onChange?: () => void
```

在 `createScheduler` 内定义 `const changed = (): void => { try { opts.onChange?.() } catch { /* 观察者的错不能打断调度 */ } }`，并在这五处末尾调用 `changed()`：
`rejectQueued`（`entry.reject(...)` 之后）、`start`（把 entry 放进 `running` 之后）、运行结束处（`running.delete(entry.work.id)` 之后）、`submit`（`queue.push` 之后、`pump()` 之前）、`dispose`（循环结束后）。

`manager.ts:10` 的 opts 加 `onChange?: () => void`，`createScheduler({ ..., onChange: opts.onChange })`。

`controller.ts:11` 的 deps 加 `onQueueChange?: () => void`，`createRuntimeManager({ now: deps.now, mode: deps.mode, maxRunning: 1, onChange: deps.onQueueChange })`。

`ipc.ts`：在 `const reader=createPlatformReader(),controller=createRuntimeController({...})` 之前加

```ts
 // 标题栏「等待 N」靠推送，不靠渲染层轮询。调度器一变就 200ms 合并一次广播给所有窗口。
 let waitingTimer: NodeJS.Timeout | undefined
 const broadcastWaiting = (): void => {
  if (waitingTimer) return
  waitingTimer = setTimeout(() => {
   waitingTimer = undefined
   const queued = controller.manager.snapshot().queued
   for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('runtime:waiting', { queued })
  }, 200)
  waitingTimer.unref()
 }
```

`createRuntimeController({ ..., onQueueChange: broadcastWaiting })`（注意 `controller` 在箭头函数里才被读，定义顺序无所谓）。再加一个 handler（放在 `runtime:monitor` 旁）：

```ts
 guardedHandle('runtime:waiting', async event => {
  if(event.senderFrame!==event.sender.mainFrame||!BrowserWindow.fromWebContents(event.sender))throw new Error('Only workbench may read the queue')
  return { queued: controller.manager.snapshot().queued }
 })
```

`preload/index.ts`：在 `runtimeMonitor` 那行下面加

```ts
  runtimeWaiting: (): Promise<{queued:number}> => ipcRenderer.invoke('runtime:waiting'),
  onRuntimeWaiting: (cb: (d: {queued:number}) => void): (() => void) => onRuntimeWaitingShared(cb),
```

并在文件顶部 `onBrowserFavorites` 旁定义 `const onRuntimeWaitingShared = createSharedChannel<{queued:number}>(ipcRenderer, 'runtime:waiting')`。

- [ ] **Step 4: 跑测试与类型检查**

Run: `node --test src/main/runtime/scheduler.test.ts && npm run typecheck`
Expected: scheduler 测试全绿（含新增）；typecheck 0 错。

- [ ] **Step 5: 提交**

```bash
git add src/main/runtime/scheduler.ts src/main/runtime/scheduler.test.ts src/main/runtime/manager.ts src/main/runtime/controller.ts src/main/runtime/ipc.ts src/preload/index.ts
git commit -m "feat(runtime): 调度器队列变化推送 runtime:waiting，给标题栏临时提示用"
```

---

### Task 3: 设置导航加「运行与资源」页

**Files:**
- Modify: `src/renderer/src/features/workspace/settingsNavigation.ts`
- Test: `src/renderer/src/features/workspace/settingsNavigation.test.ts`

**Interfaces:**
- Produces: `SETTINGS_PAGES` 里新增 `{ key: 'runtime', label: '运行与资源', group: '系统管理' }`，`SettingsPageKey` 自动包含 `'runtime'`

- [ ] **Step 1: 改测试（先红）**

把第一条测试改为：

```ts
test('all existing settings stay in three groups, MCP and runtime have their own pages',()=>{
 assert.equal(SETTINGS_PAGES.length,11)
 assert.equal(new Set(SETTINGS_PAGES.map(x=>x.group)).size,3)
 for(const key of ['theme','ai','sound','update','board','phone','perf','privacy','keys','mcp','runtime'])assert.equal(settingsPage(key).key,key)
 // 运行与资源排在更新之后、性能与诊断之前
 const keys=SETTINGS_PAGES.map(x=>x.key)
 assert.ok(keys.indexOf('update')<keys.indexOf('runtime')&&keys.indexOf('runtime')<keys.indexOf('perf'))
})
```

第二条里 `assert.equal(findSettingsPages(' ').length,10)` 改成 `11`，并加一行 `assert.deepEqual(findSettingsPages('排队').map(x=>x.key),['runtime'])`。

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test src/renderer/src/features/workspace/settingsNavigation.test.ts`
Expected: `length` 10≠11 → FAIL

- [ ] **Step 3: 实现**

在 `update` 与 `perf` 之间插入：

```ts
 {key:'runtime',label:'运行与资源',group:'系统管理',description:'看机器现在多忙、谁在排队、有什么在跑。',keywords:'运行 资源 排队 等待 托管 服务 终端 对话 CPU 内存 阈值 节能 关闭 取消 定位'},
```

`perf` 那条的 `keywords` 里删掉与运行无关的重复词不用动；`description` 保持。

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test src/renderer/src/features/workspace/settingsNavigation.test.ts`
Expected: 全绿

- [ ] **Step 5: 提交**

```bash
git add src/renderer/src/features/workspace/settingsNavigation.ts src/renderer/src/features/workspace/settingsNavigation.test.ts
git commit -m "feat(settings): 导航新增「运行与资源」页"
```

---

### Task 4: 「运行与资源」页组件 + 样式，接进设置面板

**Files:**
- Create: `src/renderer/src/features/workspace/RuntimeSettingsPage.tsx`
- Create: `src/renderer/src/features/workspace/RuntimeServiceCards.tsx`
- Create: `src/renderer/src/features/workspace/runtimeSettings.css`
- Modify: `src/renderer/src/features/workspace/SettingsPanel.tsx:667`（`tab === 'perf' && <RuntimeMonitorPanel />` 改为 `tab === 'runtime' && <RuntimeSettingsPage />`，import 换掉）
- Test: `src/renderer/src/features/workspace/settingsHierarchy.test.mjs`（追加一条）

**Interfaces:**
- Consumes: Task 1 全部导出；`window.api.runtimeMonitor / runtimeSetMode / runtimeCancelTask / runtimeStopPlugin`；`resolveStopNotice` from `src/shared/runtimeStopNotice`；`runtimeProjectLabels` from `src/shared/runtimeProjectLabels`
- Produces: `RuntimeSettingsPage`（无 props）；`RuntimeServiceCards({ services, mode, labelOf, onStop, onLocate, canLocate })`；`window.__easRuntimeLocate` **不存在**——定位在 Task 6 才接，这里 `onLocate` 先不传（按钮不渲染）。

- [ ] **Step 1: 写失败的静态测试（追加到 settingsHierarchy.test.mjs）**

```js
test('runtime page lives in settings and perf no longer embeds the old monitor panel',()=>{
 assert.match(source,/tab === 'runtime' && <RuntimeSettingsPage/)
 assert.ok(!source.includes('RuntimeMonitorPanel'))
 const page=fs.readFileSync(new URL('./RuntimeSettingsPage.tsx',import.meta.url),'utf8')
 // 三段准入范围说明一字不删：抽样各取一句
 for(const s of ['不包含 AI 会话内部工具','跨窗口共享服务不可关闭','重启即清'])assert.ok(page.includes(s),s)
 // 折叠是组件 state，不持久化
 assert.ok(!page.includes('localStorage'))
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test src/renderer/src/features/workspace/settingsHierarchy.test.mjs`
Expected: 找不到 `RuntimeSettingsPage.tsx` → FAIL

- [ ] **Step 3: 写 `RuntimeServiceCards.tsx`**

```tsx
// 托管服务：项目卡片 + 芯片；点芯片弹出小面板（状态、时长、归属、定位 / 关闭）。
// 视觉稿 docs/prototype/2026-09-14-runtime-center.html 提案 02。
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { RuntimeObservedService } from '../../../../shared/runtimeResources'
import { KIND_LABEL, fmtDuration, groupServices, serviceLeafRef } from './runtimeView'

const ICON: Record<RuntimeObservedService['kind'], string> = {
  terminal: 'M4 5h16v14H4z M7 9l3 3-3 3 M12 15h5',
  agent: 'M12 3l1.8 4.6L18 9.4l-4.2 1.8L12 16l-1.8-4.8L6 9.4l4.2-1.8z M5 18l.8 2 .8-2 2-.8-2-.8-.8-2-.8 2-2 .8z',
  plugin: 'M4 6h16v12H4z M4 10h16 M9 10v8',
  'language-server': 'M8 4c-2 0-3 1-3 3v2c0 1-1 2-2 2 1 0 2 1 2 2v2c0 2 1 3 3 3 M16 4c2 0 3 1 3 3v2c0 1 1 2 2 2-1 0-2 1-2 2v2c0 2-1 3-3 3',
  voice: 'M12 3a3 3 0 013 3v6a3 3 0 01-6 0V6a3 3 0 013-3z M6 11a6 6 0 0012 0 M12 17v4',
  cli: 'M4 7l8-4 8 4v10l-8 4-8-4z M4 7l8 4 8-4 M12 11v10'
}
const Icon = ({ kind }: { kind: RuntimeObservedService['kind'] }): JSX.Element => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d={ICON[kind]} /></svg>
)

interface Props {
  services: readonly RuntimeObservedService[]
  mode: 'project' | 'kind'
  labelOf: (projectId: string) => string
  onStop: (service: RuntimeObservedService) => void
  /** 不传 = 不显示「定位」（Task 6 接） */
  onLocate?: (service: RuntimeObservedService) => void
  canLocate?: (service: RuntimeObservedService) => boolean
}

export function RuntimeServiceCards({ services, mode, labelOf, onStop, onLocate, canLocate }: Props): JSX.Element {
  const [openId, setOpenId] = useState<string | null>(null)
  const anchor = useRef<HTMLButtonElement | null>(null)
  const pop = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const open = services.find((s) => s.id === openId) ?? null

  // 面板贴着芯片下方；放不下就翻到上方。滚动 / 点空白 / Esc 关掉。
  useEffect(() => {
    if (!open) { setPos(null); return }
    const a = anchor.current
    if (!a) return
    const r = a.getBoundingClientRect()
    const w = 250
    const left = Math.min(Math.max(8, r.left), innerWidth - w - 8)
    let top = r.bottom + 6
    requestAnimationFrame(() => {
      const h = pop.current?.getBoundingClientRect().height ?? 0
      if (top + h > innerHeight - 8) top = r.top - h - 6
      setPos({ left, top })
    })
    const close = (): void => setOpenId(null)
    const down = (e: MouseEvent): void => { if (!pop.current?.contains(e.target as Node) && !a.contains(e.target as Node)) close() }
    const key = (e: KeyboardEvent): void => { if (e.key === 'Escape') close() }
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key)
    document.addEventListener('scroll', close, true)
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); document.removeEventListener('scroll', close, true) }
  }, [open])

  const groups = groupServices(services, mode, labelOf)
  return (
    <>
      <div className="rs-cards">
        {groups.map((g) => (
          <div className="rs-card" key={g.key}>
            <div className="rs-card-hd"><span>{g.title}</span><span className="rs-n">{g.items.length}</span></div>
            <div className="rs-chips">
              {g.items.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className="rs-chip"
                  aria-haspopup="dialog"
                  aria-expanded={openId === s.id}
                  ref={openId === s.id ? anchor : undefined}
                  onClick={(e) => { anchor.current = e.currentTarget; setOpenId(openId === s.id ? null : s.id) }}
                >
                  <Icon kind={s.kind} />
                  <em>{mode === 'project' ? s.name : (s.projectIds.length ? s.projectIds.map(labelOf).join('、') : '未关联')}</em>
                  <span className={`rs-st ${s.state === 'stopping' ? 'warn pulse' : 'ok'}`} title={s.state === 'stopping' ? '停止中' : '运行中'} />
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      {open && pos && createPortal(
        <div ref={pop} className="rs-pop" role="dialog" aria-label={open.name} style={pos}>
          <div className="rs-pop-t"><Icon kind={open.kind} />{open.name}</div>
          <div className="rs-pop-m">
            <span className={`rs-st ${open.state === 'stopping' ? 'warn pulse' : 'ok'}`}>{open.state === 'stopping' ? '停止中' : '运行中'}</span>
            <span>{fmtDuration(open.uptimeMs)}</span>
            <span className="rs-pill">{KIND_LABEL[open.kind]}</span>
            {(open.projectIds.length ? open.projectIds.map(labelOf) : ['未关联']).map((p) => <span className="rs-pill" key={p}>{p}</span>)}
            {!open.canStop && open.state === 'running' && <span className="rs-pill">跨窗口共享</span>}
            {open.unknownRefs > 0 && <span className="rs-pill">{open.unknownRefs} 个引用归属待识别</span>}
          </div>
          <div className="rs-pop-a">
            {onLocate && serviceLeafRef(open.id) && (
              <button type="button" className="cset-btn" disabled={canLocate ? !canLocate(open) : false} title={canLocate && !canLocate(open) ? '这个服务不在画布的模块里' : '把画布视口挪到这个模块'} onClick={() => { setOpenId(null); onLocate(open) }}>定位</button>
            )}
            <button type="button" className="cset-btn" disabled={!open.canStop} title={!open.canStop ? (open.state === 'stopping' ? '正在停止' : '跨窗口共享，不能从本窗口关闭') : undefined} onClick={() => { setOpenId(null); onStop(open) }}>关闭</button>
          </div>
          {!open.canStop && open.state === 'running' && <div className="rs-pop-hint">跨窗口共享，不能从本窗口关闭</div>}
        </div>,
        document.body
      )}
    </>
  )
}
```

- [ ] **Step 4: 写 `RuntimeSettingsPage.tsx`**

把 `RuntimeMonitorPanel.tsx` 的数据逻辑（3 秒轮询、模式切换、stop/task notice）原样搬过来，渲染按视觉稿：

```tsx
// 设置 › 系统管理 › 运行与资源。原 RuntimeMonitorPanel（右侧贴边的运行中心）的替代者。
// 数据逻辑没变：3 秒轮询 runtimeMonitor，只在本页挂着时跑；动作全走既有 IPC。
import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../../store'
import type { RuntimeMonitorSnapshot, RuntimeObservedService } from '../../../../shared/runtimeResources'
import { resolveStopNotice, type RuntimeStopNotice } from '../../../../shared/runtimeStopNotice'
import { runtimeProjectLabels } from '../../../../shared/runtimeProjectLabels'
import { OUTCOME_LABEL, fmtAgo, fmtDuration, matchProject, queueReasonLabel, servicesSummary } from './runtimeView'
import { RuntimeServiceCards } from './RuntimeServiceCards'
import './runtimeSettings.css'

const NOTE = {
  tasks: '显示当前窗口的面板调用、终端、AI（含 ACP）与语言服务器启动、ASR 模型启动与解码、VAD 与流式识别启动，代码地图的符号索引、知识库图谱与体检的全库扫描、你点下的更新包下载，以及应用自己发起的 CLI 更新下载与插件服务器进程启动；不包含 AI 会话内部工具。取消是通知，不保证插件立即结束；应用级任务不归任何窗口，这里只显示不能取消。',
  services: '当前列出插件宿主、终端、AI 进程（含 ACP）、语言服务器、ASR 驻留模型、VAD 及流式识别线程；流式音频采用有界缓冲，积压超限会停止并提示，不是逐帧硬限额。其它后台入口仍未全部覆盖。语言服务器仅启动受准入，存量索引工作尚不可抢占。跨窗口共享服务不可关闭。',
  recent: '本窗口与应用级的任务、服务结束记录（完成 / 取消 / 排队超时 / 失败 / 退出），只留最近若干条，重启即清。'
}
const gib = (n: number): string => (n / 1024 ** 3).toFixed(1)

function Meter({ value, threshold }: { value: number | null; threshold: number }): JSX.Element {
  const v = value ?? 0
  const cls = v >= threshold ? 'danger' : v >= threshold * 0.85 ? 'warn' : ''
  return (
    <div className={`rs-meter ${cls}`} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v)}>
      <i style={{ width: `${Math.max(0, Math.min(100, v))}%` }} />
      <b style={{ left: `${threshold}%` }} data-l={`${threshold}%`} />
    </div>
  )
}

function SectionHead({ title, count, note, open, onToggle }: { title: string; count: number; note: string; open?: boolean; onToggle?: () => void }): JSX.Element {
  return (
    <div className="rs-sec-hd">
      {onToggle ? (
        <button type="button" className="rs-tg" aria-expanded={open} onClick={onToggle}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg><span>{title}</span>
        </button>
      ) : <h4>{title}</h4>}
      <span className="rs-n">{count}</span>
      <details className="rs-note"><summary>包含什么 ▾</summary><p>{note}</p></details>
    </div>
  )
}

export function RuntimeSettingsPage(): JSX.Element {
  const projects = useStore((s) => s.projects)
  const labelOf = (id: string): string => runtimeProjectLabels([id], projects)[0].replace(/（[^）]*）$/, '')
  const [sample, setSample] = useState<RuntimeMonitorSnapshot | null>(null)
  const [error, setError] = useState('')
  const [stopNotice, setStopNotice] = useState<RuntimeStopNotice>({ id: null, message: '' })
  const [taskNotice, setTaskNotice] = useState('')
  const [changingMode, setChangingMode] = useState(false)
  const [modeError, setModeError] = useState('')
  const [projectFilter, setProjectFilter] = useState('')
  const [mode, setMode] = useState<'project' | 'kind'>('project')
  // 折叠是本页的 state：每次打开设置都回到默认收起（这是「出问题时看一眼」的面板，别记住上次）
  const [openServices, setOpenServices] = useState(false)
  const [openRecent, setOpenRecent] = useState(false)

  useEffect(() => {
    let alive = true, timer: ReturnType<typeof setTimeout> | undefined
    const read = async (): Promise<void> => {
      try { const s = await window.api.runtimeMonitor(); if (alive) { setSample(s); setError('') } }
      catch { if (alive) { setSample(null); setError('资源读数暂不可用') } }
      finally { if (alive) timer = setTimeout(read, 3000) }
    }
    void read()
    return () => { alive = false; if (timer) clearTimeout(timer) }
  }, [])
  useEffect(() => { setStopNotice((c) => resolveStopNotice(c, sample?.services)) }, [sample])

  const tasks = useMemo(() => (sample?.tasks ?? []).filter((t) => matchProject(projectFilter, [t.projectId])), [sample, projectFilter])
  const services = useMemo(() => (sample?.services ?? []).filter((s) => matchProject(projectFilter, s.projectIds.length ? s.projectIds : [null])), [sample, projectFilter])
  const recent = useMemo(() => (sample?.recent ?? []).filter((r) => matchProject(projectFilter, [r.projectId])), [sample, projectFilter])
  const involved = useMemo(() => [...new Set([...(sample?.tasks ?? []).map((t) => t.projectId), ...(sample?.services ?? []).flatMap((s) => s.projectIds), ...(sample?.recent ?? []).map((r) => r.projectId)].filter((id): id is string => !!id))], [sample])
  const threshold = sample?.threshold ?? (sample?.mode === 'eco' ? 50 : 80)
  const waiting = (sample?.tasks ?? []).filter((t) => t.state === 'queued').length
  const showServices = openServices || projectFilter !== ''
  const showRecent = openRecent || projectFilter !== ''

  const stop = async (service: RuntimeObservedService): Promise<void> => {
    try {
      const result = await window.api.runtimeStopPlugin(service.id)
      setStopNotice({ id: result.ok ? service.id : null, message: result.ok ? '已请求关闭，等待进程退出' : (result.reason ?? '未关闭') })
    } catch { setStopNotice({ id: null, message: '关闭失败' }) }
  }
  const memPct = sample && sample.memoryUsedBytes !== null && sample.totalMemoryBytes ? (sample.memoryUsedBytes / sample.totalMemoryBytes) * 100 : null

  return (
    <section className="rs-page" aria-label="运行与资源">
      <div className="rs-modebar">
        <span>资源模式</span>
        <div className="rs-seg" role="group" aria-label="资源模式">
          {(['normal', 'eco'] as const).map((m) => (
            <button key={m} type="button" aria-pressed={sample?.mode === m} disabled={changingMode || !sample} onClick={async () => {
              setChangingMode(true); setModeError('')
              try { const next = await window.api.runtimeSetMode(m); setSample((s) => (s ? { ...s, ...next } : s)) }
              catch { setModeError('模式保存失败，原设置未改变') }
              finally { setChangingMode(false) }
            }}>{m === 'normal' ? '普通' : '节能'}<small>{m === 'normal' ? '80%' : '50%'}</small></button>
          ))}
        </div>
        <span className="rs-dim">{sample?.enforcement === 'plugin-tools' ? '软准入：插件工具、终端、AI 与语言服务器启动' : '仅监测'}</span>
        <details className="rs-note rs-note-right"><summary>阈值怎么起作用 ▾</summary><p>普通 80% / 节能 50%：CPU 或内存超过当前阈值时暂停启动新工具，不是瞬时硬上限。未知成本的工具保守串行，排队最长 60 秒，不自动重试。{sample?.memoryMethod === 'mac-resident-estimate' ? '内存为驻留占用估计，不等同系统内存压力。' : sample ? `内存口径：${sample.memoryMethod}。` : ''}</p></details>
      </div>
      {modeError && <p role="status">{modeError}</p>}
      {error ? <p role="status">{error}</p> : sample ? (
        <>
          {sample.metricsAvailable === false && <p role="status">资源采样暂不可用，新任务保持等待；仍可取消任务和关闭所属服务。</p>}
          <div className="rs-kpis">
            <div className="rs-tile"><div className="rs-lab"><span>CPU</span><em>{sample.logicalCpus || '未知'} 核</em></div><div className="rs-val">{sample.cpuPercent === null ? '采样中' : sample.cpuPercent.toFixed(1)}<small>%</small></div><Meter value={sample.cpuPercent} threshold={threshold} /></div>
            <div className="rs-tile"><div className="rs-lab"><span>内存</span><em>{sample.memoryMethod === 'mac-resident-estimate' ? '驻留估计' : ''}</em></div><div className="rs-val">{sample.memoryUsedBytes === null ? '未知' : gib(sample.memoryUsedBytes)}<small>/ {sample.totalMemoryBytes ? gib(sample.totalMemoryBytes) : '?'} GB</small></div><Meter value={memPct} threshold={threshold} /></div>
            <div className="rs-tile rs-count"><div className="rs-lab"><span>托管服务</span></div><div className="rs-val">{sample.services?.length ?? 0}</div></div>
            <div className="rs-tile rs-count"><div className="rs-lab"><span>等待中</span></div><div className={`rs-val${waiting ? ' warn' : ''}`}>{waiting}</div></div>
          </div>
          <div className="rs-kpi-note"><span className="rs-dot" />整机读数 · 每 3 秒刷新 · 离开本页即停止</div>
          <div className="rs-tools">
            {involved.length > 0 && (
              <select aria-label="按项目筛选" value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)}>
                <option value="">全部项目</option>
                {involved.map((id) => <option key={id} value={id}>{labelOf(id)}</option>)}
                <option value="none">未关联项目</option>
              </select>
            )}
            <div className="rs-seg" role="group" aria-label="分组方式">
              <button type="button" aria-pressed={mode === 'project'} onClick={() => setMode('project')}>按项目</button>
              <button type="button" aria-pressed={mode === 'kind'} onClick={() => setMode('kind')}>按类型</button>
            </div>
          </div>

          <section className="rs-sec">
            <SectionHead title="任务与启动队列" count={tasks.length} note={NOTE.tasks} />
            {taskNotice && <p role="status">{taskNotice}</p>}
            {!tasks.length ? <div className="rs-empty">{projectFilter ? '该筛选下没有任务' : '当前没有执行或等待中的任务'}</div> : (
              <div className="rs-list">
                {tasks.map((task) => (
                  <div className="rs-row" key={task.id}>
                    <div className="rs-row-main">
                      <div className="rs-row-name"><span>{task.name}</span>{task.scope === 'app' && <span className="rs-pill">应用级</span>}<span className="rs-pill">{task.projectId ? labelOf(task.projectId) : '未关联'}</span></div>
                      <div className="rs-row-meta">
                        {task.state === 'queued' ? <><span className="rs-st warn pulse">排队中</span><span>{queueReasonLabel(task.reason)}</span></> : task.state === 'cancel-requested' ? <span className="rs-st warn">等待取消确认</span> : <span className="rs-st ok">执行中</span>}
                        <span>{fmtDuration(task.ageMs)}</span>
                      </div>
                    </div>
                    {task.scope === 'app' ? <span className="rs-pill" title="所有窗口可见，不能从窗口取消">不能取消</span> : (
                      <button type="button" className="cset-btn" disabled={task.state === 'cancel-requested'} onClick={async () => {
                        try { const r = await window.api.runtimeCancelTask(task.id); setTaskNotice(r.ok ? '取消请求已处理；运行中的任务需等待实际结束' : '任务已结束或不属于当前窗口'); if (r.ok) setSample(await window.api.runtimeMonitor()) }
                        catch { setTaskNotice('取消通知失败，未关闭插件服务') }
                      }}>取消</button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="rs-sec">
            <SectionHead title="托管服务" count={services.length} note={NOTE.services} open={showServices} onToggle={() => setOpenServices((v) => !v)} />
            {stopMessage(stopNotice) && <p role="status">{stopMessage(stopNotice)}</p>}
            {!services.length ? <div className="rs-empty">{projectFilter ? '该筛选下没有服务' : '当前没有运行中的托管服务'}</div>
              : showServices ? <RuntimeServiceCards services={services} mode={mode} labelOf={labelOf} onStop={(s) => void stop(s)} />
              : <Summary services={services} onClick={() => setOpenServices(true)} />}
          </section>

          <section className="rs-sec">
            <SectionHead title="最近结束" count={recent.length} note={NOTE.recent} open={showRecent} onToggle={() => setOpenRecent((v) => !v)} />
            {!recent.length ? <div className="rs-empty">{projectFilter ? '该筛选下没有记录' : '还没有结束的任务或服务'}</div>
              : showRecent ? (
                <div className="rs-list">
                  {recent.slice(0, 20).map((item, i) => (
                    <div className="rs-row rs-row-recent" key={item.id + ':' + i}>
                      <span className={`rs-st ${item.outcome === 'done' ? 'ok' : item.outcome === 'failed' ? 'bad' : item.outcome === 'timeout' ? 'warn' : 'off'}`} title={OUTCOME_LABEL[item.outcome]} />
                      <div className="rs-row-main">
                        <div className="rs-row-name"><span>{item.name}</span>{item.scope === 'app' && <span className="rs-pill">应用级</span>}<span className="rs-pill">{item.projectId ? labelOf(item.projectId) : '未关联'}</span></div>
                        <div className="rs-row-meta"><span>{OUTCOME_LABEL[item.outcome]}</span><span>{fmtAgo(item.ageMs)}</span>{item.durationMs >= 1000 && <span>用时 {fmtDuration(item.durationMs)}</span>}</div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <button type="button" className="rs-sum" onClick={() => setOpenRecent(true)}>
                  <span>最新 <b>{recent[0].name}</b> · {OUTCOME_LABEL[recent[0].outcome]} · {fmtAgo(recent[0].ageMs)}</span><span className="rs-more">展开</span>
                </button>
              )}
          </section>
          <div className="rs-foot"><span>取消是通知，不保证插件立即结束</span><span>跨窗口共享服务不可关闭</span><span>应用级任务不归任何窗口</span></div>
        </>
      ) : <p role="status">正在读取设备信息…</p>}
    </section>
  )
}

function stopMessage(n: RuntimeStopNotice): string { return n.message }

function Summary({ services, onClick }: { services: readonly RuntimeObservedService[]; onClick: () => void }): JSX.Element {
  const s = servicesSummary(services)
  return (
    <button type="button" className="rs-sum" onClick={onClick} aria-label="展开托管服务">
      {s.kinds.map((k) => <span className="rs-k" key={k.kind}>{k.label}<b>{k.count}</b></span>)}
      {s.stopping > 0 && <span className="rs-att">{s.stopping} 个停止中</span>}
      <span className="rs-more">展开</span>
    </button>
  )
}
```

- [ ] **Step 5: 写 `runtimeSettings.css`（全部用令牌）**

```css
/* 设置 › 运行与资源。视觉稿 docs/prototype/2026-09-14-runtime-center.html 提案 02。
   只用 base.css 令牌；分区折叠、卡片、芯片、弹出面板。 */
.rs-page { display: flex; flex-direction: column; gap: 0; }
.rs-modebar { display: flex; align-items: center; gap: 12px; font-size: 11.5px; color: var(--t-3); }
.rs-dim { color: var(--t-3); }
.rs-seg { display: flex; gap: 3px; padding: 3px; background: var(--wash-1); border-radius: 9px; }
.rs-seg button { border: 0; background: none; padding: 5px 11px; border-radius: 6px; font: inherit; font-size: 11.5px; color: var(--t-3); cursor: pointer; white-space: nowrap; }
.rs-seg button[aria-pressed='true'] { background: var(--lift-3); color: var(--t-1); }
.rs-seg button:disabled { opacity: .5; cursor: default; }
.rs-seg small { font-size: 10px; opacity: .7; margin-left: 4px; font-variant-numeric: tabular-nums; }
.rs-note { position: relative; font-size: 11px; color: var(--t-3); }
.rs-note-right { margin-left: auto; }
.rs-note summary { cursor: pointer; list-style: none; user-select: none; }
.rs-note summary::-webkit-details-marker { display: none; }
.rs-note summary:hover { color: var(--t-2); }
.rs-note p { margin: 6px 0 0; padding: 10px 12px; border-radius: var(--radius-sm); background: var(--glass-3); backdrop-filter: var(--blur); border: 1px solid var(--glass-border-strong); color: var(--t-3); font-size: 11px; line-height: 1.75; position: absolute; right: 0; top: 100%; width: min(460px, 70vw); z-index: 3; box-shadow: 0 12px 40px var(--ink-3); }
.rs-kpis { display: grid; grid-template-columns: 1.5fr 1.5fr 1fr 1fr; gap: 8px; margin-top: 14px; }
.rs-tile { padding: 12px 14px; border-radius: var(--radius-md); background: var(--lift-1); }
.rs-lab { font-size: 11px; color: var(--t-3); display: flex; justify-content: space-between; align-items: baseline; }
.rs-lab em { font-style: normal; font-size: 10px; }
.rs-val { font-size: 22px; font-weight: 600; letter-spacing: -.2px; color: var(--t-1); line-height: 1.25; margin-top: 2px; }
.rs-val small { font-size: 11px; font-weight: 400; color: var(--t-3); margin-left: 6px; letter-spacing: 0; }
.rs-val.warn { color: var(--sem-warn); }
.rs-meter { position: relative; height: 4px; border-radius: 2px; background: var(--lift-2); margin-top: 10px; }
.rs-meter i { display: block; height: 100%; border-radius: 2px; background: var(--accent); transition: width .3s; }
.rs-meter.warn i { background: var(--sem-warn); }
.rs-meter.danger i { background: var(--sem-danger); }
.rs-meter b { position: absolute; top: -4px; width: 1px; height: 12px; background: var(--t-2); }
.rs-meter b::after { content: attr(data-l); position: absolute; top: 13px; left: -10px; font-size: 9px; font-weight: 400; color: var(--t-3); white-space: nowrap; }
.rs-kpi-note { display: flex; align-items: center; gap: 8px; margin-top: 10px; font-size: 11px; color: var(--t-3); }
.rs-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--sem-ok); box-shadow: 0 0 0 3px rgba(var(--sem-ok-rgb), .15); }
.rs-tools { display: flex; align-items: center; gap: 8px; margin: 16px 0 2px; }
.rs-tools select { height: 28px; padding: 0 10px; border-radius: var(--radius-sm); border: 1px solid var(--stroke-input); background: var(--lift-1); font: inherit; font-size: 11.5px; color: var(--t-1); max-width: 260px; }
.rs-tools .rs-seg { margin-left: auto; }
.rs-sec { margin-top: 18px; position: relative; }
.rs-sec-hd { display: flex; align-items: baseline; gap: 8px; margin: 0 0 8px; padding: 0 2px; }
.rs-sec-hd h4 { margin: 0; font-size: 12px; font-weight: 600; color: var(--t-1); }
.rs-tg { display: inline-flex; align-items: center; gap: 6px; border: 0; background: none; padding: 0; font: inherit; font-size: 12px; font-weight: 600; color: var(--t-1); cursor: pointer; }
.rs-tg svg { width: 12px; height: 12px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; color: var(--t-3); transition: transform .15s; }
.rs-tg[aria-expanded='true'] svg { transform: rotate(90deg); }
.rs-n { font-size: 10.5px; color: var(--t-3); padding: 1px 6px; border-radius: 5px; background: var(--lift-1); font-variant-numeric: tabular-nums; }
.rs-sec-hd .rs-note { margin-left: auto; }
.rs-list { border-radius: var(--radius-md); background: var(--lift-1); overflow: hidden; }
.rs-row { display: flex; align-items: center; gap: 10px; padding: 8px 14px; min-height: 44px; }
.rs-row + .rs-row { border-top: 1px solid var(--glass-border); }
.rs-row-main { flex: 1; min-width: 0; }
.rs-row-name { font-size: 12.5px; color: var(--t-1); display: flex; align-items: center; gap: 7px; }
.rs-row-name > span:first-child { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rs-row-meta { font-size: 11px; color: var(--t-3); margin-top: 1px; display: flex; gap: 6px; align-items: center; flex-wrap: wrap; font-variant-numeric: tabular-nums; }
.rs-row-recent { min-height: 38px; }
.rs-st { display: inline-flex; align-items: center; gap: 5px; }
.rs-st::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: var(--t-3); }
.rs-st.ok::before { background: var(--sem-ok); }
.rs-st.warn::before { background: var(--sem-warn); }
.rs-st.bad::before { background: var(--sem-danger); }
.rs-st.off::before { opacity: .6; }
.rs-st.pulse::before { animation: rs-pulse 1.6s ease-in-out infinite; }
@keyframes rs-pulse { 50% { opacity: .35; } }
.rs-pill { font-size: 9.5px; padding: 0 5px; height: 16px; line-height: 16px; border-radius: 4px; background: var(--lift-2); color: var(--t-2); white-space: nowrap; }
.rs-empty { padding: 22px 14px; text-align: center; color: var(--t-3); font-size: 11.5px; border-radius: var(--radius-md); background: var(--lift-1); }
.rs-sum { width: 100%; display: flex; flex-wrap: wrap; gap: 6px 12px; padding: 9px 12px; border: 0; border-radius: var(--radius-md); background: var(--lift-1); font: inherit; font-size: 11px; color: var(--t-2); cursor: pointer; align-items: center; text-align: left; }
.rs-sum:hover { background: var(--lift-2); }
.rs-k { display: inline-flex; align-items: center; gap: 5px; font-variant-numeric: tabular-nums; }
.rs-k b { font-weight: 500; color: var(--t-1); }
.rs-att { margin-left: auto; color: var(--sem-warn); }
.rs-more { margin-left: auto; color: var(--t-3); }
.rs-att + .rs-more { margin-left: 0; }
.rs-cards { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.rs-card { padding: 10px 12px 11px; border-radius: var(--radius-md); background: var(--lift-1); min-width: 0; }
.rs-card-hd { display: flex; align-items: baseline; gap: 6px; margin-bottom: 8px; font-size: 11.5px; font-weight: 500; color: var(--t-2); }
.rs-card-hd > span:first-child { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rs-card-hd .rs-n { margin-left: auto; font-weight: 400; }
.rs-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.rs-chip { height: 24px; padding: 0 8px 0 7px; border: 0; border-radius: 6px; background: var(--lift-2); color: var(--t-1); display: inline-flex; align-items: center; gap: 5px; font: inherit; font-size: 11px; max-width: 100%; cursor: pointer; }
.rs-chip svg, .rs-pop-t svg { width: 12px; height: 12px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; opacity: .85; flex: none; }
.rs-chip em { font-style: normal; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rs-chip .rs-st::before { width: 5px; height: 5px; }
.rs-chip:hover { background: var(--lift-3); }
.rs-chip[aria-expanded='true'] { background: var(--hl-bg); color: var(--hl-fg); }
.rs-pop { position: fixed; z-index: 3600; width: 250px; padding: 12px 12px 10px; border-radius: var(--radius-md); background: var(--glass-3); backdrop-filter: var(--blur); border: 1px solid var(--glass-border-strong); box-shadow: var(--glass-highlight), 0 16px 50px var(--ink-3); color: var(--fg); }
.rs-pop-t { font-size: 12.5px; font-weight: 600; color: var(--t-1); display: flex; align-items: center; gap: 6px; }
.rs-pop-m { font-size: 11px; color: var(--t-3); margin-top: 3px; display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.rs-pop-a { display: flex; gap: 6px; margin-top: 10px; }
.rs-pop-a .cset-btn { flex: 1; }
.rs-pop-hint { font-size: 10.5px; color: var(--t-3); margin-top: 6px; }
.rs-foot { margin-top: 18px; padding-top: 10px; border-top: 1px solid var(--glass-border); font-size: 10.5px; color: var(--t-3); display: flex; gap: 14px; flex-wrap: wrap; }
@media (max-width: 720px) { .rs-kpis { grid-template-columns: 1fr 1fr; } .rs-cards { grid-template-columns: 1fr; } .rs-tools { flex-wrap: wrap; } }
```

说明：`.rs-pop` 的 `z-index: 3600` 要压过设置弹窗（`.cset-overlay` 为 3500 级，见 `workspace.css`）；落地时用 `grep -n 'z-index' src/renderer/src/features/workspace/workspace.css | grep cset` 核一遍，取比设置弹窗高一档的值。

- [ ] **Step 6: 接进 SettingsPanel**

`SettingsPanel.tsx`：把 `import { RuntimeMonitorPanel } from './RuntimeMonitorPanel'` 改成 `import { RuntimeSettingsPage } from './RuntimeSettingsPage'`；第 667 行 `{tab === 'perf' && <RuntimeMonitorPanel />}` 改为 `{tab === 'runtime' && <RuntimeSettingsPage />}`。
`perf` 页保留第 621 行图形加速与 668 行起的诊断日志段不动。

- [ ] **Step 7: 类型检查 + 静态测试**

Run: `npm run typecheck && node --test src/renderer/src/features/workspace/settingsHierarchy.test.mjs`
Expected: 0 错；新增测试通过（此时 `RuntimeCenter.tsx` 仍 import `RuntimeMonitorPanel`，测试断言的是 SettingsPanel 源码，不受影响）。

- [ ] **Step 8: 提交**

```bash
git add src/renderer/src/features/workspace/RuntimeSettingsPage.tsx src/renderer/src/features/workspace/RuntimeServiceCards.tsx src/renderer/src/features/workspace/runtimeSettings.css src/renderer/src/features/workspace/SettingsPanel.tsx src/renderer/src/features/workspace/settingsHierarchy.test.mjs
git commit -m "feat(settings): 「运行与资源」页——读数量表、项目卡片 + 芯片、默认折叠留摘要"
```

---

### Task 5: 标题栏临时提示 `TitlebarAlert`，拆掉 MCP 灯与运行按钮

**Files:**
- Create: `src/renderer/src/features/workspace/TitlebarAlert.tsx`
- Modify: `src/renderer/src/App.tsx`（去掉 `<McpIndicator />` 与 `<RuntimeCenter />`，在原 `McpIndicator` 位置放 `<TitlebarAlert />`；删两个 import、加一个）
- Modify: `src/renderer/src/features/workspace/McpIndicator.tsx`（删 `McpIndicator` 组件与 `ago`，只留 `McpBody`；文件名不改，避免牵动 SettingsPanel 的 import）
- Delete: `src/renderer/src/features/workspace/RuntimeCenter.tsx`、`RuntimeMonitorPanel.tsx`、`runtimeCenter.css`
- Modify: `src/renderer/src/features/workspace/workspace.css:818-830`（`.mcp-ind.*` 三条规则改成 `.tb-alert` 一组）
- Test: `src/renderer/src/features/workspace/settingsHierarchy.test.mjs`（第一条改为断言 `TitlebarAlert.tsx`）

**Interfaces:**
- Consumes: Task 2 的 `window.api.runtimeWaiting` / `onRuntimeWaiting`；store 的 `mcpEnabled`、`mcpLog`
- Produces: `TitlebarAlert`（无 props）

- [ ] **Step 1: 改静态测试（先红）**

`settingsHierarchy.test.mjs` 第一条改为：

```js
test('titlebar alert opens MCP page; MCP body stays in settings; no permanent MCP/runtime titlebar entries',()=>{
 const alert=fs.readFileSync(new URL('./TitlebarAlert.tsx',import.meta.url),'utf8')
 assert.ok(alert.includes("tab: 'mcp'"))
 assert.ok(alert.includes("tab: 'runtime'"))
 assert.match(source,/tab === 'mcp'[\s\S]*?<McpBody/)
 const app=fs.readFileSync(new URL('../../App.tsx',import.meta.url),'utf8')
 assert.ok(!app.includes('<McpIndicator'))
 assert.ok(!app.includes('<RuntimeCenter'))
 assert.ok(app.includes('<TitlebarAlert'))
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test src/renderer/src/features/workspace/settingsHierarchy.test.mjs`
Expected: 找不到 `TitlebarAlert.tsx` → FAIL

- [ ] **Step 3: 写 `TitlebarAlert.tsx`**

```tsx
// 标题栏唯一的运行态提示：**有事才出现，没事不渲染**（和 UpdateBadge 同一模式）。
//   · 等待 N   —— 调度器里有任务排队（终端 / AI 启动被资源准入挡住）。点开设置 › 运行与资源。
//                 模块本身还不显示排队态，这是用户唯一能知道「为什么点了没反应」的地方（用户 2026-09-14 拍板）。
//   · MCP 已拒 N —— MCP 接入关着，却仍有调用进来被拒。点开设置 › MCP 接入；打开过即清零。
// 2026-09-14 起标题栏不再常驻「MCP」灯与「运行 N」按钮：排队数改由主进程推送（runtime:waiting），这里不轮询。
import { useEffect, useState } from 'react'
import { useStore } from '../../store'

export function TitlebarAlert(): JSX.Element | null {
  const [queued, setQueued] = useState(0)
  useEffect(() => {
    let alive = true
    void window.api.runtimeWaiting().then((r) => { if (alive) setQueued(r.queued) }).catch(() => { /* 读不到就当 0 */ })
    const off = window.api.onRuntimeWaiting(({ queued: n }) => setQueued(n))
    return () => { alive = false; off() }
  }, [])
  const mcpEnabled = useStore((s) => s.mcpEnabled)
  const mcpLog = useStore((s) => s.mcpLog)
  const [seenMcpId, setSeenMcpId] = useState(0)
  const rejected = mcpEnabled ? 0 : mcpLog.filter((e) => !e.ok && e.id > seenMcpId).length

  const open = (tab: 'runtime' | 'mcp'): void => {
    if (tab === 'mcp') setSeenMcpId(mcpLog[0]?.id ?? 0)
    window.dispatchEvent(new CustomEvent('eas:open-settings', { detail: { tab } }))
  }
  if (!queued && !rejected) return null
  return (
    <>
      {queued > 0 && (
        <button type="button" className="tb-item tb-alert" data-tip="有任务在排队等资源，点开看原因" onClick={() => open('runtime')}>等待 {queued}</button>
      )}
      {rejected > 0 && (
        <button type="button" className="tb-item tb-alert" data-tip="MCP 接入已关闭，AI 的调用被拒了，点开查看" onClick={() => open('mcp')}>MCP 已拒 {rejected}</button>
      )}
    </>
  )
}
```

`open('runtime')` 里的字符串写成 `{ detail: { tab: 'runtime' } }`、`open('mcp')` 对应 `tab: 'mcp'`——静态测试搜的是这两个字面量；上面 `open(tab)` 的写法测试搜不到，改成两个独立的 `dispatchEvent` 调用各自写死 `tab: 'runtime'` / `tab: 'mcp'`。

- [ ] **Step 4: 改 App.tsx、McpIndicator.tsx、workspace.css，删三个文件**

`App.tsx`：`import {RuntimeCenter} from './features/workspace/RuntimeCenter'` 删；`McpIndicator` 的 import 删（若同文件里 `McpBody` 不由 App 引用）；加 `import { TitlebarAlert } from './features/workspace/TitlebarAlert'`；标题栏里 `<McpIndicator />` 换成 `<TitlebarAlert />`，`<RuntimeCenter />` 那行删（连同它上面的注释）。
`McpIndicator.tsx`：删掉 `McpIndicator` 函数与 `ago`、`useRef/useEffect/useState` 中不再用的 import；文件头注释改为「标题栏那盏灯 2026-09-14 拆了（有事才冒头的提示在 TitlebarAlert.tsx），这里只剩设置里的 McpBody」。
`workspace.css:818-830` 三条 `.mcp-ind` 规则替换为：

```css
/* 标题栏临时提示（TitlebarAlert）：只在有任务排队 / MCP 拒调用时出现 */
.titlebar-actions .tb-item.tb-alert { color: var(--sem-warn); background: rgba(var(--sem-warn-rgb), .12); font-variant-numeric: tabular-nums; }
.titlebar-actions .tb-item.tb-alert::before { content: ''; display: inline-block; width: 5px; height: 5px; border-radius: 50%; background: var(--sem-warn); margin-right: 6px; animation: rs-pulse 1.6s ease-in-out infinite; }
```

（`rs-pulse` 在 `runtimeSettings.css` 里定义；那份 CSS 由 `RuntimeSettingsPage` import，设置没打开过时未加载——所以把 `@keyframes rs-pulse` **挪到 `workspace.css`**，`runtimeSettings.css` 里删掉那条 keyframes。）

`git rm src/renderer/src/features/workspace/RuntimeCenter.tsx src/renderer/src/features/workspace/RuntimeMonitorPanel.tsx src/renderer/src/features/workspace/runtimeCenter.css`

`grep -rn 'runtime-center\|RuntimeCenter\|RuntimeMonitorPanel' src scripts docs/architecture` 确认没有别的引用（`scripts/verify-*.mjs` 若引用 `.runtime-center-trigger`，同步改成 `.tb-alert` 或删掉那段）。

- [ ] **Step 5: 类型检查 + 静态测试**

Run: `npm run typecheck && node --test src/renderer/src/features/workspace/settingsHierarchy.test.mjs`
Expected: 全绿

- [ ] **Step 6: 提交**

```bash
git add -A src/renderer/src/App.tsx src/renderer/src/features/workspace
git commit -m "feat(titlebar): 拆掉 MCP 灯与运行按钮，换成有事才出现的临时提示（等待 N / MCP 已拒 N）"
```

---

### Task 6: 「定位」——从服务芯片跳到画布模块

**Files:**
- Create: `src/renderer/src/features/workspace/runtimeLocate.ts`
- Test: `src/renderer/src/features/workspace/runtimeLocate.test.ts`
- Modify: `src/renderer/src/features/workspace/RuntimeSettingsPage.tsx`（给 `RuntimeServiceCards` 传 `onLocate` / `canLocate`）
- Modify: `src/renderer/src/features/workspace/SettingsPanel.tsx:296-304`（加 `eas:close-settings` 监听 → `setOpen(false)`）

**Interfaces:**
- Consumes: Task 1 `serviceLeafRef`；`collectLeaves` from `src/renderer/src/layout.ts`；store `tabs`、`canvas.frames`、`focusCanvasNode`、`setViewMode`
- Produces: `findServiceNode(serviceId, tabs, frames): { frameId: string; nodeId: string } | null`（纯函数）；`locateService(serviceId): boolean`（有副作用）

- [ ] **Step 1: 写失败的测试**

```ts
// src/renderer/src/features/workspace/runtimeLocate.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findServiceNode } from './runtimeLocate.ts'

const tabs = [{ id: 't1', projectId: 'p', cwd: '/x', root: { type: 'split', dir: 'h', ratio: .5,
  a: { type: 'leaf', id: 'leaf-term', pane: { kind: 'terminal', ptyId: '17' } },
  b: { type: 'leaf', id: 'leaf-agent', pane: { kind: 'agent', sessionId: 'ac-3' } } } }] as never
const frames = [{ id: 'frame-1', nodes: [{ id: 'n1', leafId: 'leaf-term' }, { id: 'n2', leafId: 'leaf-agent' }] }, { id: 'frame-2', nodes: [{ id: 'n3', leafId: 'leaf-other' }] }] as never

test('pty 服务对到终端节点，agent 服务对到对话节点', () => {
  assert.deepEqual(findServiceNode('pty:17', tabs, frames), { frameId: 'frame-1', nodeId: 'n1' })
  assert.deepEqual(findServiceNode('agent:ac-3:5', tabs, frames), { frameId: 'frame-1', nodeId: 'n2' })
})
test('不是 pty/agent、或 leaf 不在画布上、或找不到 leaf → null', () => {
  assert.equal(findServiceNode('lsp:ts', tabs, frames), null)
  assert.equal(findServiceNode('pty:999', tabs, frames), null)
  assert.equal(findServiceNode('pty:17', tabs, [] as never), null)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test src/renderer/src/features/workspace/runtimeLocate.test.ts`
Expected: 找不到模块 → FAIL

- [ ] **Step 3: 实现**

```ts
// src/renderer/src/features/workspace/runtimeLocate.ts
// 「定位」：服务 id → 画布上的模块。纯渲染层：主进程给的 id 里带 ptyId / sessionId，
// 渲染层的 leaf pane 里正好也有（layout.ts PaneState）。找不到就 null，按钮置灰。
import { collectLeaves, type LayoutNode } from '../../layout'
import { useStore } from '../../store'
import { serviceLeafRef } from './runtimeView'

interface TabLike { root: LayoutNode }
interface FrameLike { id: string; nodes: readonly { id: string; leafId?: string }[] }

export function findServiceNode(serviceId: string, tabs: readonly TabLike[], frames: readonly FrameLike[]): { frameId: string; nodeId: string } | null {
  const ref = serviceLeafRef(serviceId)
  if (!ref) return null
  const leaf = tabs.flatMap((t) => collectLeaves(t.root)).find((l) =>
    ref.kind === 'terminal' ? l.pane.kind === 'terminal' && l.pane.ptyId === ref.ptyId
      : l.pane.kind === 'agent' && l.pane.sessionId === ref.sessionId)
  if (!leaf) return null
  for (const f of frames) {
    const n = f.nodes.find((x) => x.leafId === leaf.id)
    if (n) return { frameId: f.id, nodeId: n.id }
  }
  return null
}

/** 能不能定位（给按钮置灰用） */
export function canLocateService(serviceId: string): boolean {
  const s = useStore.getState()
  return findServiceNode(serviceId, s.tabs, s.canvas.frames) !== null
}

/** 关掉设置、切到画布、把视口挪过去并选中。返回是否成功。 */
export function locateService(serviceId: string): boolean {
  const s = useStore.getState()
  const hit = findServiceNode(serviceId, s.tabs, s.canvas.frames)
  if (!hit) return false
  window.dispatchEvent(new CustomEvent('eas:close-settings'))
  if (s.viewMode !== 'canvas') s.setViewMode('canvas')
  useStore.getState().focusCanvasNode(hit.frameId, hit.nodeId)
  return true
}
```

`collectLeaves` 与 `LayoutNode` 的确切导出名以 `src/renderer/src/layout.ts` 为准（`canvasSlice.ts` 里 `collectLeaves(t.root)` 就是它）；`setViewMode` 签名见 `canvasSlice.ts:160` 附近。

`RuntimeSettingsPage.tsx` 里 `<RuntimeServiceCards ... onLocate={(s) => { locateService(s.id) }} canLocate={(s) => canLocateService(s.id)} />`。

`SettingsPanel.tsx` 在 `eas:open-settings` 的 effect 旁加：

```ts
  useEffect(() => {
    const h = (): void => setOpen(false)
    window.addEventListener('eas:close-settings', h)
    return () => window.removeEventListener('eas:close-settings', h)
  }, [])
```

- [ ] **Step 4: 跑测试与类型检查**

Run: `node --test src/renderer/src/features/workspace/runtimeLocate.test.ts && npm run typecheck`
Expected: 全绿

- [ ] **Step 5: 提交**

```bash
git add src/renderer/src/features/workspace/runtimeLocate.ts src/renderer/src/features/workspace/runtimeLocate.test.ts src/renderer/src/features/workspace/RuntimeSettingsPage.tsx src/renderer/src/features/workspace/SettingsPanel.tsx
git commit -m "feat(runtime): 服务芯片「定位」跳到画布模块（pty/agent id ↔ leaf pane）"
```

---

### Task 7: 图纸、更新日志、全量测试与 CDP 真机验收

**Files:**
- Modify: `docs/architecture/10-模块领地图.md`（`features/workspace` 相关行：运行中心 → 设置页、TitlebarAlert、runtime:waiting 推送）
- Modify: `docs/architecture/13-所有权矩阵.md`（跨文件同步清单加一条：`TitlebarAlert` 的 `tab: 'runtime'|'mcp'` ↔ `settingsNavigation.ts` 的 key）
- Modify: `CHANGELOG.md`（新版本条目，版本号先不升，写在 `## 0.4.97 — 待定` 下，发版时改日期）
- Create: `docs/verification/runtime-settings/2026-09-14-真机验收.md` + 截图

- [ ] **Step 1: 全量测试与构建**

Run: `npm test 2>&1 | grep -E '^ℹ (tests|pass|fail)' && npm run typecheck && npm run build`
Expected: `fail 0`；0 错；三个 `built in`

- [ ] **Step 2: 起隔离实例，验标题栏与设置页**

```bash
node scripts/verify-app.mjs --seed &   # 等 12 秒
node scripts/eval-in-app.mjs "(()=>({mcp:!!document.querySelector('.mcp-ind'),run:!!document.querySelector('.runtime-center-trigger'),alert:document.querySelectorAll('.tb-alert').length}))()"
# 期望 {mcp:false, run:false, alert:0}
node scripts/eval-in-app.mjs "(()=>{window.dispatchEvent(new CustomEvent('eas:open-settings',{detail:{tab:'runtime'}}));return new Promise(r=>setTimeout(()=>r({page:!!document.querySelector('.rs-page'),tiles:document.querySelectorAll('.rs-tile').length,summary:document.querySelector('.rs-sum')?.textContent,cards:document.querySelectorAll('.rs-card').length}),1500))})()"
# 期望 page:true, tiles:4, summary 含「终端 5」, cards:0（默认折叠）
node scripts/eval-in-app.mjs "(()=>{document.querySelector('.rs-sum').click();return new Promise(r=>setTimeout(()=>r({cards:document.querySelectorAll('.rs-card').length,chips:document.querySelectorAll('.rs-chip').length}),300))})()"
# 期望 cards ≥ 5, chips ≥ 6
node scripts/eval-in-app.mjs "(()=>{document.querySelector('.rs-chip').click();return new Promise(r=>setTimeout(()=>{const p=document.querySelector('.rs-pop');r({pop:!!p,text:p&&p.textContent.slice(0,60),locate:!!p&&!!p.querySelector('button:not([disabled])')})},300))})()"
# 期望 pop:true，text 含「运行中」，locate:true（终端在画布上）
node scripts/eval-in-app.mjs "(()=>{[...document.querySelectorAll('.rs-pop button')].find(b=>b.textContent==='定位').click();return new Promise(r=>setTimeout(()=>r({settingsOpen:!!document.querySelector('.rs-page'),sel:document.querySelectorAll('.pane.sel').length}),800))})()"
# 期望 settingsOpen:false, sel:1
```

用 `Page.captureScreenshot`（`/tmp/eas-cap.mjs` 那种 8 行脚本）截「设置页默认折叠」「展开卡片 + 弹出面板」两张，放 `docs/verification/runtime-settings/`。
**注意**：隔离窗口无焦点时 `html[data-visual-paused]` 会暂停全部动画，验呼吸点动画前先 `document.documentElement.removeAttribute('data-visual-paused')`。

- [ ] **Step 3: 「等待 N」提示的验收范围（已知限制，写进验收文档）**

隔离实例里稳定制造排队做不到：用户发起的终端 / AI 启动是**交互型**，按设计只在严重内存压力下才排队；主进程也没有把 `manager` 暴露给 inspector 的入口。所以这条提示分两层验：

1. 推送链路：Task 2 的调度器 `onChange` 单测（入队 / 开跑 / 结束 / 取消各触发一次）。
2. 渲染层：在隔离实例里直接挂一个 `TitlebarAlert` 的替身不划算——改为静态断言（Task 5 的测试已钉 `tab: 'runtime'` / `tab: 'mcp'` 两个入口）+ 手工观察：正式版切「节能 50%」后在机器高负载时开一个新终端，标题栏应出现「等待 1」，终端起来后消失。

验收文档里明确写「等待 N 未在隔离实例复现，按上述两层验」，不要写成已验证。

- [ ] **Step 4: 更新图纸与更新日志**

`10-模块领地图.md`：找到 `features/workspace` 相关行（`grep -n 'RuntimeCenter\|运行中心\|McpIndicator' docs/architecture/10-模块领地图.md`），把「运行中心是右侧贴边对话框」「标题栏 MCP 灯」的描述改为：运行中心 = 设置 `runtime` 页（`RuntimeSettingsPage` + `RuntimeServiceCards` + 纯函数 `runtimeView.ts` / `runtimeLocate.ts`）；标题栏只有 `TitlebarAlert`，排队数由 `runtime/ipc.ts` 的 `runtime:waiting` 推送（调度器 `onChange` → 200ms 合并广播）；`McpIndicator.tsx` 只剩 `McpBody`。
`13-所有权矩阵.md` 跨文件同步清单加：`TitlebarAlert.tsx` 里的 `tab: 'runtime'` / `tab: 'mcp'` 与 `settingsNavigation.ts` 的 key 成对（`settingsHierarchy.test.mjs` 钉着）。
`CHANGELOG.md` 顶部加：

```markdown
## 0.4.97 — 待定

### 改进
- 运行中心搬进设置，成为「系统管理 › 运行与资源」一页：读数带阈值刻度，托管服务按项目收成卡片、默认折叠一行摘要，点芯片能关闭或直接定位到画布上的模块。
- 标题栏不再常驻 MCP 灯和「运行」按钮；只在有任务排队等资源、或 MCP 关着仍有调用被拒时，出现一个临时提示，点它直达对应设置页。
```

- [ ] **Step 5: 写验收记录并提交**

`docs/verification/runtime-settings/2026-09-14-真机验收.md`：列 Step 1 的数字、Step 2 每条 eval 的实际返回、两张截图路径、Step 3 的已知限制。

```bash
git add docs/architecture/10-模块领地图.md docs/architecture/13-所有权矩阵.md CHANGELOG.md docs/verification/runtime-settings
git commit -m "docs(runtime): 运行与资源页图纸、更新日志与真机验收"
```

---

## Self-Review（写完后对照 spec 做过）

- **Spec 覆盖**：决定 1（设置页 + 删对话框 + perf 不再内嵌）→ Task 3/4/5；决定 2（拆标题栏）→ Task 5；决定 3（临时提示 + 推送）→ Task 2/5；决定 4（只在页内轮询）→ Task 4 的 effect；决定 5（页内布局、折叠、包含什么）→ Task 4；决定 6（卡片 + 芯片 + 弹出）→ Task 4；决定 7（定位）→ Task 6。验收判据 → Task 7。
- **占位扫描**：Task 7 Step 3 原本想写「在主进程投占位任务」，实测路径不通，已改成明确的已知限制而不是 TBD。
- **类型一致性**：`serviceLeafRef` 在 Task 1 定义、Task 4/6 使用同名；`onRuntimeWaiting` / `runtimeWaiting` 在 Task 2 定义、Task 5 使用同名；`findServiceNode` / `locateService` / `canLocateService` 在 Task 6 内一致；`RuntimeServiceCards` 的 `onLocate` / `canLocate` 两处签名一致。
