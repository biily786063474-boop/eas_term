# Opus 作品画廊插件 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 画布上可视化浏览 389 件 Opus 5.5 代码动画作品，点选后把「以它为风格参考、换成我的主题」的指令挂到当前对话输入框。

**Architecture:** 宿主只补一条通用通道——渲染层 `PluginPanel.tsx` 就地处理面板发来的 `ui/message`，挂成对话输入框上的 chip。画廊本身是个人插件（`plugins-dev/opus-gallery/`，不进安装包），手写 JSON-RPC 的 MCP stdio server 负责拉 GitHub 清单、缓存图片到 `$EAS_PLUGIN_DATA`、拼注入文本；面板是单文件 HTML，走 MCP Apps postMessage 协议。

**Tech Stack:** TypeScript（渲染层）、Node 26 原生 ESM（插件 server，零依赖，全局 `fetch`）、`node:test` + `node:assert/strict`、纯内联 HTML/CSS/JS 面板。

**Spec:** `docs/superpowers/specs/2026-09-28-opus-gallery-design.md`

## Global Constraints

- 工作目录：worktree `.worktrees/opus-gallery`，分支 `feat/opus-gallery-20260928`，基线 `origin/main` 764499ab。所有命令在 worktree 根目录跑。
- 插件源码只放 `plugins-dev/opus-gallery/`，**不许**放进 `resources/plugins/`（那里会被 `package.json` 的 `extraResources` 打包分发——版权原因，本期只给用户本人用）。
- 数据源 `https://raw.githubusercontent.com/yihui-dev/awesome-opus5-5-videos/main/data/videos.json`；预览图 `https://media.skillry.dev/opus-5-5/<slug>/preview.webp`。
- 缓存目录只用 `process.env.EAS_PLUGIN_DATA`（宿主给的 `userData/plugin-data/opus-gallery/`）。
- 面板 CSP 固定为 `img-src data: blob:; connect-src 'none'`（`src/main/panelHtml.ts:13`，有测试锁，**不许改**）：面板不能直接联网，图片一律 data URL。
- 上游是第三方内容：面板渲染一律 `textContent`，面板文件里不得出现 `innerHTML`。slug 只收 `/^[A-Za-z0-9][A-Za-z0-9_-]{0,100}$/`。
- `ui/message` 文本上限 60000 字；chip label 超 40 字截断；没有已登记的对话输入框时回错误，**不降级写终端**。
- 测试框架是 `node:test`，**不是** vitest。单文件跑：`node --test <file>`。全量：`npm test`。
- 改了代码同 commit 更新 `docs/architecture/` 对应图纸（仓库 CLAUDE.md 规矩）。
- commit 信息结尾带：`Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`

## File Structure

| 文件 | 职责 |
|---|---|
| `src/renderer/src/features/plugins/uiMessage.ts`（新） | 纯函数：校验 `ui/message` 参数 → chip |
| `src/renderer/src/features/plugins/uiMessage.test.ts`（新） | 上面的单测 |
| `src/renderer/src/features/plugins/uiMessageWiring.test.mjs`（新） | 源码断言：PluginPanel 就地处理、不写终端 |
| `src/renderer/src/features/plugins/PluginPanel.tsx`（改） | switch 加 `case 'ui/message'` |
| `plugins-dev/opus-gallery/lib/core.mjs`（新） | 纯函数：归一、筛选分页、标签计数、注入拼装、预设增删 |
| `plugins-dev/opus-gallery/lib/store.mjs`（新） | 网络 + 磁盘：清单同步（ETag）、离线回退、图片缓存、并发上限 |
| `plugins-dev/opus-gallery/server.mjs`（新） | MCP stdio：工具表与分发 |
| `plugins-dev/opus-gallery/plugin.json`（新） | 清单 |
| `plugins-dev/opus-gallery/ui/panel.html`（新） | 面板 |
| `plugins-dev/opus-gallery/lib/*.test.mjs`（新） | core / store / server / panel 测试 |
| `scripts/install-dev-plugin.sh`（新） | 逐文件拷到 `~/.eas/plugins/<name>/` 并核对大小 |
| `package.json`（改） | `test` 脚本加 `'plugins-dev/*/lib/*.test.mjs'` |
| `docs/architecture/10、11、13`（改） | 插件协议 `ui/message` 的落点与同步链 |

---

### Task 1: 宿主就地处理 `ui/message`

**Files:**
- Create: `src/renderer/src/features/plugins/uiMessage.ts`
- Create: `src/renderer/src/features/plugins/uiMessage.test.ts`
- Create: `src/renderer/src/features/plugins/uiMessageWiring.test.mjs`
- Modify: `src/renderer/src/features/plugins/PluginPanel.tsx`（`onMsg` 的 `switch (r.method)`，约 :132-189，在 `case 'eas/panel.resize'` 之后）
- Modify: `docs/architecture/10-模块领地图.md`（约 :108 PluginPanel 行）、`11-MCP工具网络.md`（约 :154-155 方法清单）、`13-所有权矩阵.md`（约 :310 `panel/timeline-report` 同步链旁）

**Interfaces:**
- Consumes: `DictChip`（`src/renderer/src/features/agentChat/chips.ts:9`，`{ id; label; text }`）；`useStore.getState().composerAddChip`（`uiSlice.ts:91`）；PluginPanel 里已有的 `post`、`resultResponse`、`errorResponse(id, code, msg)`、`state.title`、`pluginId`。
- Produces: `uiMessageChip(params: unknown, panel: { id: string; title: string }): { ok: true; chip: DictChip } | { ok: false; error: string }`；常量 `UI_MESSAGE_MAX_CHARS = 60000`、`UI_MESSAGE_LABEL_MAX = 40`、`NO_COMPOSER_ERROR`。面板侧请求形状：`{ role: 'user', content: [{ type: 'text', text }], _meta?: { eas?: { label?: string } } }`，成功响应 `{}`。

- [ ] **Step 1: 写失败的单测**

`src/renderer/src/features/plugins/uiMessage.test.ts`：

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { uiMessageChip, UI_MESSAGE_MAX_CHARS, UI_MESSAGE_LABEL_MAX } from './uiMessage.ts'

const P = { id: 'eas:opus-gallery', title: 'Opus 画廊' }
const msg = (text: string, label?: string): unknown => ({
  role: 'user',
  content: [{ type: 'text', text }],
  ...(label ? { _meta: { eas: { label } } } : {})
})

test('规范形状 → chip：label 带面板名前缀，id 按插件 + 正文去重', () => {
  const a = uiMessageChip(msg('参考这件作品', '@u1 风格'), P)
  assert.equal(a.ok, true)
  if (!a.ok) return
  assert.equal(a.chip.label, 'Opus 画廊 · @u1 风格')
  assert.equal(a.chip.text, '参考这件作品')
  assert.match(a.chip.id, /^plugin:eas:opus-gallery:[0-9a-f]{8}$/)
  const b = uiMessageChip(msg('参考这件作品', '别的名字'), P)
  assert.ok(b.ok && b.chip.id === a.chip.id, '同一段正文重复点不应挂两个')
  const c = uiMessageChip(msg('另一段'), P)
  assert.ok(c.ok && c.chip.id !== a.chip.id)
})

test('多个 text 块按空行拼接，非 text 块忽略', () => {
  const r = uiMessageChip({ role: 'user', content: [{ type: 'text', text: '甲' }, { type: 'image', data: 'x' }, { type: 'text', text: '乙' }] }, P)
  assert.ok(r.ok && r.chip.text === '甲\n\n乙')
})

test('缺省 label 取正文前 20 字；过长 label 截断', () => {
  const long = '一二三四五六七八九十'.repeat(3)
  const r = uiMessageChip(msg(long), P)
  assert.ok(r.ok && r.chip.label === 'Opus 画廊 · ' + long.slice(0, 20))
  const t = uiMessageChip(msg('正文', 'x'.repeat(80)), P)
  assert.ok(t.ok && t.chip.label === 'Opus 画廊 · ' + 'x'.repeat(UI_MESSAGE_LABEL_MAX - 1) + '…')
})

test('拒绝：非对象、非 user、空正文、超长', () => {
  assert.equal(uiMessageChip(null, P).ok, false)
  assert.equal(uiMessageChip({ role: 'assistant', content: [{ type: 'text', text: 'x' }] }, P).ok, false)
  assert.equal(uiMessageChip(msg('   '), P).ok, false)
  const big = uiMessageChip(msg('x'.repeat(UI_MESSAGE_MAX_CHARS + 1)), P)
  assert.equal(big.ok, false)
  if (!big.ok) assert.match(big.error, /60000/)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test src/renderer/src/features/plugins/uiMessage.test.ts`
Expected: FAIL，`Cannot find module ... uiMessage.ts`

- [ ] **Step 3: 写实现**

`src/renderer/src/features/plugins/uiMessage.ts`：

```ts
// 面板 → 宿主 `ui/message`：把面板给的一段话挂成对话输入框上的 chip。
// **纯函数，不 import React / store** —— 取 composerAddChip、回响应都在 PluginPanel 里。
// 参数按 ext-apps 规范：{ role:'user', content:[{ type:'text', text }] }；
// `_meta.eas.label` 是 Eas-Term 扩展，chip 上显示的短名，别的宿主不认也不影响。
// 设计稿：docs/superpowers/specs/2026-09-28-opus-gallery-design.md §二
import type { DictChip } from '../agentChat/chips.ts'

/** 数据集最长提示词 22367 字，加模板和附加约束留足余量 */
export const UI_MESSAGE_MAX_CHARS = 60000
export const UI_MESSAGE_LABEL_MAX = 40
/** 没有可注入的输入框时回给面板的话。**不降级写终端**：几百字灌进 CLI 输入行会被当场提交，撤不回。 */
export const NO_COMPOSER_ERROR = '没有可注入的对话框，先点一下要注入的对话框'

export type UiMessageChip = { ok: true; chip: DictChip } | { ok: false; error: string }

function fnv1a(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

function clip(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

export function uiMessageChip(params: unknown, panel: { id: string; title: string }): UiMessageChip {
  if (!params || typeof params !== 'object') return { ok: false, error: '参数不是对象' }
  const p = params as { role?: unknown; content?: unknown; _meta?: { eas?: { label?: unknown } } }
  if (p.role !== 'user') return { ok: false, error: '只接受 role: user' }
  const blocks = Array.isArray(p.content) ? p.content : []
  const text = blocks
    .filter((b): b is { type: 'text'; text: string } => !!b && (b as { type?: unknown }).type === 'text' && typeof (b as { text?: unknown }).text === 'string')
    .map((b) => b.text)
    .join('\n\n')
  if (!text.trim()) return { ok: false, error: '正文为空' }
  if (text.length > UI_MESSAGE_MAX_CHARS) return { ok: false, error: `正文超过 ${UI_MESSAGE_MAX_CHARS} 字` }
  const given = typeof p._meta?.eas?.label === 'string' ? p._meta.eas.label.trim() : ''
  const label = clip(given || text.trim().slice(0, 20), UI_MESSAGE_LABEL_MAX)
  return { ok: true, chip: { id: `plugin:${panel.id}:${fnv1a(text)}`, label: `${panel.title} · ${label}`, text } }
}
```

- [ ] **Step 4: 跑单测确认通过**

Run: `node --test src/renderer/src/features/plugins/uiMessage.test.ts`
Expected: PASS（4 tests）

- [ ] **Step 5: 写失败的接线测试**

`src/renderer/src/features/plugins/uiMessageWiring.test.mjs`：

```js
// 源码断言：pluginHost 顶层 import electron、PluginPanel 是 React 组件，都没法直接跑，
// 照 src/main/pluginPopupSecurity.test.mjs 的做法钉住关键接线。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const src = fs.readFileSync(new URL('./PluginPanel.tsx', import.meta.url), 'utf8')

test('PluginPanel 就地处理 ui/message：挂 chip，不转主进程、不写终端', () => {
  const start = src.indexOf("case 'ui/message':")
  assert.ok(start > 0, '缺 ui/message 分支')
  const end = src.indexOf('case ', start + 20)
  const body = src.slice(start, end > 0 ? end : start + 1200)
  assert.match(body, /uiMessageChip\(r\.params/)
  assert.match(body, /useStore\.getState\(\)\.composerAddChip/)
  assert.match(body, /NO_COMPOSER_ERROR/)
  assert.doesNotMatch(body, /panelRpc|pty|\.write\(/)
})
```

- [ ] **Step 6: 跑确认失败**

Run: `node --test src/renderer/src/features/plugins/uiMessageWiring.test.mjs`
Expected: FAIL，`缺 ui/message 分支`

- [ ] **Step 7: 接进 PluginPanel**

在 `PluginPanel.tsx` 顶部 import 区加（若 `useStore` 已 import 就别重复；若 `JSONRPC_INVALID_PARAMS` 没 import，从 `'../../../../shared/pluginProtocol.ts'` 引，路径照同文件已有的 shared import 写法）：

```ts
import { uiMessageChip, NO_COMPOSER_ERROR } from './uiMessage.ts'
```

在 `case 'eas/panel.resize': { ... }` 之后、`default:` 之前插入：

```tsx
        case 'ui/message': {
          // 面板要往对话里塞一段话：挂成 chip，发送那一刻才展开（chips.ts）。
          // 就地处理不绕主进程——composerAddChip 只在渲染层；弹窗面板也允许，它不碰画布节点。
          const res = uiMessageChip(r.params, { id: pluginId ?? '', title: state.title })
          if (!res.ok) { post(errorResponse(r.id, JSONRPC_INVALID_PARAMS, res.error)); return }
          const add = useStore.getState().composerAddChip
          if (!add) { post(errorResponse(r.id, -32603, NO_COMPOSER_ERROR)); return }
          add(res.chip)
          post(resultResponse(r.id, {}))
          return
        }
```

- [ ] **Step 8: 跑两份测试 + 类型检查**

Run: `node --test src/renderer/src/features/plugins/uiMessage.test.ts src/renderer/src/features/plugins/uiMessageWiring.test.mjs src/renderer/src/features/plugins/appsProtocol.test.ts src/renderer/src/features/dict/designSourceWiring.test.mjs`
Expected: 全 PASS

Run: `npm run typecheck`（若脚本名不同，看 `package.json` 的 scripts 里 `tsc` 那条）
Expected: 无新增错误

- [ ] **Step 9: 更新三份图纸**

先读对应行确认上下文，再加：

- `10-模块领地图.md` PluginPanel / appsProtocol 那行（约 :108）末尾补：「`ui/message` 在 PluginPanel 就地处理：`uiMessage.ts` 判断参数 → 挂 `composerAddChip` chip；无输入框回错，不降级写终端。」
- `11-MCP工具网络.md` 方法清单（约 :154-155）补：「`ui/message`：渲染层就地处理，不经 `plugin:panelRpc`，会话 shim 不认。」
- `13-所有权矩阵.md` 同步链（约 :310 `panel/timeline-report` 旁）加一行：「`ui/message`：`shared/pluginProtocol.ts`（VIEW_REQUESTS）→ `PluginPanel.tsx` case → `uiMessage.ts` → `agentChat/chips.ts` addChip。chip id 前缀 `plugin:`；改前缀先看 addChip 对 `design:` 的特判。」

- [ ] **Step 10: Commit**

```bash
git add src/renderer/src/features/plugins/uiMessage.ts src/renderer/src/features/plugins/uiMessage.test.ts src/renderer/src/features/plugins/uiMessageWiring.test.mjs src/renderer/src/features/plugins/PluginPanel.tsx docs/architecture/10-模块领地图.md docs/architecture/11-MCP工具网络.md docs/architecture/13-所有权矩阵.md
git commit -m "feat(plugins): handle ui/message in panel host as composer chip

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: 插件纯函数 `core.mjs`

**Files:**
- Create: `plugins-dev/opus-gallery/lib/core.mjs`
- Create: `plugins-dev/opus-gallery/lib/core.test.mjs`
- Modify: `package.json:13`（`test` 脚本末尾加 `'plugins-dev/*/lib/*.test.mjs'`）

**Interfaces:**
- Consumes: 上游条目字段 `slug / author / category / post_url / poster_url / prompt / prompt_partial / tech_tags / added`。
- Produces（Task 3、4 用）：
  - `CATEGORIES: { id: string; label: string }[]`、`PAGE_SIZE = 36`、`SLUG_RE`
  - `normalizeEntries(raw: unknown): Entry[]`，`Entry = { slug, author, postUrl, posterUrl, category, tags: string[], prompt, partial: boolean, added }`，按 `added` 降序
  - `filterPage(entries, { category?, tag?, page? }) → { items: Entry[], page, pages, total }`
  - `tagCounts(entries) → { tag: string; count: number }[]`（降序）
  - `composeInjection(entry, topic, preset?: { name; text } | null) → { label, text }`
  - `DEFAULT_PRESETS: Preset[]`，`Preset = { id, name, text }`
  - `savePreset(list, { id?, name, text }) → Preset[]`、`deletePreset(list, id) → Preset[]`

- [ ] **Step 1: 改 package.json 测试脚本**

`package.json:13` 改为：

```json
    "test": "node --test --test-concurrency=4 'src/**/*.test.ts' 'src/**/*.test.mjs' 'hooks/*.test.mjs' 'resources/plugins/*/lib/*.test.ts' 'plugins-dev/*/lib/*.test.mjs'",
```

- [ ] **Step 2: 写失败的测试**

`plugins-dev/opus-gallery/lib/core.test.mjs`：

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeEntries, filterPage, tagCounts, composeInjection, savePreset, deletePreset, PAGE_SIZE, DEFAULT_PRESETS } from './core.mjs'

const raw = (n, over = {}) => ({
  slug: `a-${n}`, author: `u${n}`, author_url: '', category: n % 2 ? 'motion' : '3d',
  post_url: `https://x.com/u/status/${n}`, poster_url: `https://m.test/${n}.webp`,
  prompt: `p${n}`, prompt_partial: false, tech_tags: n % 3 ? ['canvas'] : ['canvas', 'gsap'],
  added: `2026-09-${String(10 + (n % 20)).padStart(2, '0')}`, ...over
})

test('normalizeEntries：丢坏条目、清非 http 链接、按 added 降序', () => {
  const out = normalizeEntries([raw(1), raw(2, { slug: '../evil' }), raw(3, { prompt: '  ' }), raw(4, { post_url: 'javascript:alert(1)' })])
  assert.deepEqual(out.map((e) => e.slug), ['a-4', 'a-1'])
  assert.equal(out[0].postUrl, '')
  assert.equal(out[1].postUrl, 'https://x.com/u/status/1')
  assert.deepEqual(Object.keys(out[1]).sort(), ['added', 'author', 'category', 'partial', 'postUrl', 'posterUrl', 'prompt', 'slug', 'tags'])
  assert.throws(() => normalizeEntries({}), /不是数组/)
})

test('filterPage：分类、标签、页码夹紧、空结果仍有 1 页', () => {
  const all = normalizeEntries(Array.from({ length: 80 }, (_, i) => raw(i)))
  const m = filterPage(all, { category: 'motion' })
  assert.equal(m.total, 40)
  assert.equal(m.pages, 2)
  assert.equal(m.items.length, PAGE_SIZE)
  assert.equal(filterPage(all, { category: 'motion', page: 99 }).page, 1)
  assert.equal(filterPage(all, { page: -3 }).page, 0)
  assert.equal(filterPage(all, { tag: 'gsap' }).total, 27)
  const none = filterPage(all, { tag: 'nope' })
  assert.deepEqual([none.total, none.pages, none.items.length], [0, 1, 0])
})

test('tagCounts 降序', () => {
  const all = normalizeEntries(Array.from({ length: 6 }, (_, i) => raw(i)))
  assert.deepEqual(tagCounts(all), [{ tag: 'canvas', count: 6 }, { tag: 'gsap', count: 2 }])
})

test('composeInjection：主题、技术栈、部分公开标记、预设', () => {
  const [e] = normalizeEntries([raw(1, { prompt_partial: true, tech_tags: ['canvas', 'gsap'] })])
  const c = composeInjection(e, ' Eas-Term 宣传片 ', { name: '规范', text: '不用霓虹' })
  assert.equal(c.label, '@u1 风格')
  assert.match(c.text, /技术栈（canvas \/ gsap）/)
  assert.match(c.text, /为「Eas-Term 宣传片」做一个单文件 HTML 动画/)
  assert.match(c.text, /原作：@u1（https:\/\/x\.com\/u\/status\/1）/)
  assert.match(c.text, /原提示词（仅部分公开）：\np1/)
  assert.match(c.text, /附加约束（规范）：\n不用霓虹/)
  assert.doesNotMatch(composeInjection(e, '主题', null).text, /附加约束/)
  assert.throws(() => composeInjection(e, '   '), /主题不能为空/)
  const [longAuthor] = normalizeEntries([raw(2, { author: 'x'.repeat(60) })])
  assert.ok(composeInjection(longAuthor, '主题').label.length <= 30)
})

test('预设：默认有宣传片规范；新建、更新、校验、删除', () => {
  assert.equal(DEFAULT_PRESETS[0].id, 'eas-promo')
  let list = savePreset([], { name: '克制', text: '少动' })
  assert.equal(list.length, 1)
  assert.match(list[0].id, /^p-[0-9a-z]+$/)
  list = savePreset(list, { id: list[0].id, name: '克制 2', text: '更少动' })
  assert.deepEqual([list.length, list[0].name, list[0].text], [1, '克制 2', '更少动'])
  assert.throws(() => savePreset(list, { name: '', text: 'x' }), /名称/)
  assert.throws(() => savePreset(list, { name: 'x'.repeat(31), text: 'x' }), /名称/)
  assert.throws(() => savePreset(list, { name: 'x', text: 'y'.repeat(4001) }), /内容/)
  assert.deepEqual(deletePreset(list, list[0].id), [])
})
```

- [ ] **Step 3: 跑确认失败**

Run: `node --test plugins-dev/opus-gallery/lib/core.test.mjs`
Expected: FAIL，`Cannot find module ... core.mjs`

- [ ] **Step 4: 写实现**

`plugins-dev/opus-gallery/lib/core.mjs`：

```js
// Opus 作品画廊 · 纯函数：数据归一、筛选分页、注入文本、预设。不碰网络与磁盘。
// 设计稿：docs/superpowers/specs/2026-09-28-opus-gallery-design.md

export const CATEGORIES = [
  { id: 'motion', label: '动态图形' },
  { id: 'explainer', label: '讲解' },
  { id: '3d', label: '3D' },
  { id: 'interactive', label: '交互' }
]
export const PAGE_SIZE = 36
/** slug 会拼进缓存文件路径，只收这些字符 */
export const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,100}$/

const httpOr = (u) => (typeof u === 'string' && /^https?:\/\//.test(u) ? u : '')

export function normalizeEntries(raw) {
  if (!Array.isArray(raw)) throw new Error('videos.json 不是数组')
  const out = []
  for (const v of raw) {
    if (!v || typeof v.slug !== 'string' || !SLUG_RE.test(v.slug)) continue
    if (typeof v.prompt !== 'string' || !v.prompt.trim()) continue
    out.push({
      slug: v.slug,
      author: String(v.author ?? ''),
      postUrl: httpOr(v.post_url),
      posterUrl: httpOr(v.poster_url),
      category: String(v.category ?? ''),
      tags: Array.isArray(v.tech_tags) ? v.tech_tags.map(String) : [],
      prompt: v.prompt,
      partial: v.prompt_partial === true,
      added: String(v.added ?? '')
    })
  }
  return out.sort((a, b) => (a.added === b.added ? a.slug.localeCompare(b.slug) : a.added < b.added ? 1 : -1))
}

export function filterPage(entries, { category = '', tag = '', page = 0 } = {}) {
  const hit = entries.filter((e) => (!category || e.category === category) && (!tag || e.tags.includes(tag)))
  const pages = Math.max(1, Math.ceil(hit.length / PAGE_SIZE))
  const p = Math.min(Math.max(0, Math.trunc(Number(page) || 0)), pages - 1)
  return { items: hit.slice(p * PAGE_SIZE, (p + 1) * PAGE_SIZE), page: p, pages, total: hit.length }
}

export function tagCounts(entries) {
  const m = new Map()
  for (const e of entries) for (const t of e.tags) m.set(t, (m.get(t) ?? 0) + 1)
  return [...m].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
}

export function composeInjection(entry, topic, preset = null) {
  const t = String(topic ?? '').trim()
  if (!t) throw new Error('主题不能为空')
  const lines = [
    `参考下面这件 Opus 5.5 作品的调性、节奏、镜头语言和技术栈（${entry.tags.join(' / ') || '未标注'}），`,
    `为「${t}」做一个单文件 HTML 动画：纯内联、零外部依赖、断网可开、适合直接录屏。`,
    '不要照搬原作的内容主题，只借它的风格。',
    '',
    `原作：@${entry.author}${entry.postUrl ? `（${entry.postUrl}）` : ''}`,
    `原提示词${entry.partial ? '（仅部分公开）' : ''}：`,
    entry.prompt.trim()
  ]
  if (preset && String(preset.text ?? '').trim()) lines.push('', `附加约束（${preset.name}）：`, preset.text.trim())
  const who = entry.author.length > 24 ? entry.author.slice(0, 23) + '…' : entry.author
  return { label: `@${who} 风格`, text: lines.join('\n') }
}

export const DEFAULT_PRESETS = [
  {
    id: 'eas-promo',
    name: 'Eas-Term 宣传片规范',
    text: [
      '- 不用发光类效果：光晕爆开、冲击环、扫光、流光描边、柔光团、霓虹、镜头光晕都不要。',
      '- 界面与文字同一画面不超过 3 色；允许纯色彩块做氛围（纯色、不发光、不模糊）。',
      '- 每个镜头只讲一件事；文字和演示不同时出现。',
      '- 节奏快：按 120 BPM 卡拍，换镜落在拍点上。',
      '- 不硬切：换镜是相机在同一个世界里平移、拉远或扎进；曲线夸张（蓄力→急冲→冲过头回弹），落定要有力量感。',
      '- 任何时刻只有一种运动说了算，不要同时漂移、冲镜、震动、侧倾。',
      '- 结构总分总：先整体，再逐个讲，最后回到整体。',
      '- 文字安全区左右 192px、上下 108px（按 1920×1080）。'
    ].join('\n')
  }
]

export function savePreset(list, input) {
  const name = String(input?.name ?? '').trim()
  const text = String(input?.text ?? '').trim()
  if (!name || name.length > 30) throw new Error('预设名称要 1–30 字')
  if (!text || text.length > 4000) throw new Error('预设内容要 1–4000 字')
  const id = typeof input.id === 'string' && list.some((p) => p.id === input.id) ? input.id : `p-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  const next = { id, name, text }
  return list.some((p) => p.id === id) ? list.map((p) => (p.id === id ? next : p)) : [...list, next]
}

export function deletePreset(list, id) {
  return list.filter((p) => p.id !== id)
}
```

- [ ] **Step 5: 跑确认通过**

Run: `node --test plugins-dev/opus-gallery/lib/core.test.mjs`
Expected: PASS（5 tests）

- [ ] **Step 6: 用真实数据冒烟一次（确认 slug 规则不会误杀）**

Run:
```bash
curl -sL https://raw.githubusercontent.com/yihui-dev/awesome-opus5-5-videos/main/data/videos.json -o /tmp/opus-videos.json
node -e "import('./plugins-dev/opus-gallery/lib/core.mjs').then(m=>{const raw=JSON.parse(require('fs').readFileSync('/tmp/opus-videos.json','utf8'));const n=m.normalizeEntries(raw);console.log(raw.length,n.length)})"
```
Expected: 两个数相等（2026-09-28 时为 `389 389`）。不相等就先查被丢的条目，别放宽 `SLUG_RE` 到允许 `.` 或 `/`。

- [ ] **Step 7: Commit**

```bash
git add package.json plugins-dev/opus-gallery/lib/core.mjs plugins-dev/opus-gallery/lib/core.test.mjs
git commit -m "feat(opus-gallery): core data, paging and injection template

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: 同步与缓存 `store.mjs`

**Files:**
- Create: `plugins-dev/opus-gallery/lib/store.mjs`
- Create: `plugins-dev/opus-gallery/lib/store.test.mjs`

**Interfaces:**
- Consumes: `normalizeEntries`、`SLUG_RE`（Task 2）。
- Produces（Task 4 用）：
  - `DATA_URL`、`MEDIA_BASE = 'https://media.skillry.dev/opus-5-5'`
  - `createStore({ dir, fetchImpl?, dataUrl?, mediaBase?, timeoutMs?, maxImageBytes? })` 返回：
    - `sync(): Promise<void>`（并发调用合并成一次）
    - `ensure(): Promise<Entry[]>`（没加载过就 `sync`）
    - `image(kind: 'poster' | 'preview', entry): Promise<string>`（data URL，拉不到给 `''`）
    - `status(): { offline: boolean; lastError: string; all: number }`

- [ ] **Step 1: 写失败的测试**

`plugins-dev/opus-gallery/lib/store.test.mjs`：

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createStore } from './store.mjs'

const DATA = 'https://data.test/videos.json'
const entry = (n) => ({ slug: `a-${n}`, author: `u${n}`, category: 'motion', post_url: '', poster_url: `https://m.test/p/${n}.webp`, prompt: `p${n}`, prompt_partial: false, tech_tags: [], added: '2026-09-20' })
const body = JSON.stringify([entry(1), entry(2)])

function res(status, text = '', headers = {}) {
  return { status, ok: status >= 200 && status < 300, headers: new Headers(headers), text: async () => text, arrayBuffer: async () => new TextEncoder().encode(text).buffer }
}
function fake(routes) {
  const calls = []
  const f = async (url, init = {}) => {
    calls.push({ url, headers: init.headers ?? {} })
    const h = routes[url]
    if (!h) throw new Error('offline')
    return h(init)
  }
  f.calls = calls
  return f
}
function tmp(t) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'opus-store-'))
  t.after(() => fs.rmSync(d, { recursive: true, force: true }))
  return d
}

test('首次同步写缓存与 etag；下次带 If-None-Match，304 用缓存', async (t) => {
  const dir = tmp(t)
  const a = createStore({ dir, dataUrl: DATA, fetchImpl: fake({ [DATA]: () => res(200, body, { etag: '"v1"' }) }) })
  assert.equal((await a.ensure()).length, 2)
  assert.equal(fs.readFileSync(path.join(dir, 'etag'), 'utf8'), '"v1"')
  const f = fake({ [DATA]: () => res(304) })
  const b = createStore({ dir, dataUrl: DATA, fetchImpl: f })
  assert.equal((await b.ensure()).length, 2)
  assert.equal(f.calls[0].headers['If-None-Match'], '"v1"')
  assert.equal(b.status().offline, false)
})

test('上游失败但有缓存 → 离线模式，给出原因', async (t) => {
  const dir = tmp(t)
  await createStore({ dir, dataUrl: DATA, fetchImpl: fake({ [DATA]: () => res(200, body) }) }).ensure()
  const s = createStore({ dir, dataUrl: DATA, fetchImpl: fake({ [DATA]: () => res(502) }) })
  assert.equal((await s.ensure()).length, 2)
  assert.deepEqual(s.status(), { offline: true, lastError: '上游返回 502', all: 2 })
})

test('首次失败且无缓存 → 抛出说人话的错误', async (t) => {
  const s = createStore({ dir: tmp(t), dataUrl: DATA, fetchImpl: fake({}) })
  await assert.rejects(s.ensure(), /拉取作品清单失败：offline/)
})

test('上游给了空清单或坏 JSON 不覆盖旧缓存', async (t) => {
  const dir = tmp(t)
  await createStore({ dir, dataUrl: DATA, fetchImpl: fake({ [DATA]: () => res(200, body) }) }).ensure()
  const s = createStore({ dir, dataUrl: DATA, fetchImpl: fake({ [DATA]: () => res(200, '[]') }) })
  assert.equal((await s.ensure()).length, 2)
  assert.equal(s.status().offline, true)
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'videos.json'), 'utf8')).length, 2)
})

test('并发 ensure 只拉一次', async (t) => {
  const f = fake({ [DATA]: () => res(200, body) })
  const s = createStore({ dir: tmp(t), dataUrl: DATA, fetchImpl: f })
  await Promise.all([s.ensure(), s.ensure(), s.sync()])
  assert.equal(f.calls.length, 1)
})

test('图片：下载一次后走磁盘；失败、非 2xx、超大都给空串', async (t) => {
  const f = fake({
    [DATA]: () => res(200, body),
    'https://m.test/p/1.webp': () => res(200, 'IMG'),
    'https://m.test/p/2.webp': () => res(404),
    'https://media.test/a-1/preview.webp': () => res(200, 'X'.repeat(50))
  })
  const s = createStore({ dir: tmp(t), dataUrl: DATA, mediaBase: 'https://media.test', fetchImpl: f, maxImageBytes: 10 })
  const [e1, e2] = await s.ensure()
  const byslug = (x) => (x.slug === 'a-1' ? x : null)
  const one = [e1, e2].find(byslug)
  const two = [e1, e2].find((x) => x.slug === 'a-2')
  assert.equal(await s.image('poster', one), 'data:image/webp;base64,' + Buffer.from('IMG').toString('base64'))
  const before = f.calls.length
  await s.image('poster', one)
  assert.equal(f.calls.length, before, '第二次应读磁盘')
  assert.equal(await s.image('poster', two), '')
  assert.equal(await s.image('preview', one), '', '超过 maxImageBytes')
  assert.equal(await s.image('preview', two), '', '没有路由 = 网络失败')
})
```

- [ ] **Step 2: 跑确认失败**

Run: `node --test plugins-dev/opus-gallery/lib/store.test.mjs`
Expected: FAIL，`Cannot find module ... store.mjs`

- [ ] **Step 3: 写实现**

`plugins-dev/opus-gallery/lib/store.mjs`：

```js
// Opus 作品画廊 · 网络与磁盘：清单同步（ETag）、离线回退、图片缓存。
// 缓存目录由调用方给（server 里是宿主注入的 $EAS_PLUGIN_DATA）。
import fs from 'node:fs'
import path from 'node:path'
import { normalizeEntries, SLUG_RE } from './core.mjs'

export const DATA_URL = 'https://raw.githubusercontent.com/yihui-dev/awesome-opus5-5-videos/main/data/videos.json'
export const MEDIA_BASE = 'https://media.skillry.dev/opus-5-5'
const IMAGE_CONCURRENCY = 4

function writeAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, data)
  fs.renameSync(tmp, file)
}

export function createStore({ dir, fetchImpl = fetch, dataUrl = DATA_URL, mediaBase = MEDIA_BASE, timeoutMs = 15000, maxImageBytes = 3 * 1024 * 1024 }) {
  for (const sub of ['poster', 'preview']) fs.mkdirSync(path.join(dir, sub), { recursive: true })
  const listFile = path.join(dir, 'videos.json')
  const etagFile = path.join(dir, 'etag')
  let entries = null
  let offline = false
  let lastError = ''
  let syncing = null
  let active = 0
  const queue = []
  const inflight = new Map()

  async function timed(url, init = {}) {
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), timeoutMs)
    try {
      return await fetchImpl(url, { ...init, signal: ac.signal })
    } finally {
      clearTimeout(timer)
    }
  }

  function readCache() {
    try {
      const list = normalizeEntries(JSON.parse(fs.readFileSync(listFile, 'utf8')))
      return list.length ? list : null
    } catch {
      return null
    }
  }

  async function doSync() {
    const cached = readCache()
    const headers = {}
    if (cached && fs.existsSync(etagFile)) headers['If-None-Match'] = fs.readFileSync(etagFile, 'utf8').trim()
    try {
      const r = await timed(dataUrl, { headers })
      if (r.status === 304 && cached) {
        entries = cached
        offline = false
        lastError = ''
        return
      }
      if (!r.ok) throw new Error(`上游返回 ${r.status}`)
      const text = await r.text()
      let fresh
      try {
        fresh = normalizeEntries(JSON.parse(text))
      } catch {
        throw new Error('上游清单不是合法 JSON')
      }
      if (!fresh.length) throw new Error('上游清单为空')
      writeAtomic(listFile, text)
      const etag = r.headers.get('etag')
      if (etag) writeAtomic(etagFile, etag)
      else fs.rmSync(etagFile, { force: true })
      entries = fresh
      offline = false
      lastError = ''
    } catch (e) {
      lastError = e?.name === 'AbortError' ? '连接超时' : String(e?.message ?? e)
      if (cached) {
        entries = cached
        offline = true
        return
      }
      throw new Error(`拉取作品清单失败：${lastError}`)
    }
  }

  function sync() {
    syncing ??= doSync().finally(() => { syncing = null })
    return syncing
  }

  async function ensure() {
    if (!entries) await sync()
    return entries
  }

  async function limited(fn) {
    if (active >= IMAGE_CONCURRENCY) await new Promise((r) => queue.push(r))
    active++
    try {
      return await fn()
    } finally {
      active--
      queue.shift()?.()
    }
  }

  async function fetchImage(kind, entry, file) {
    const url = kind === 'poster' ? entry.posterUrl : `${mediaBase}/${entry.slug}/preview.webp`
    if (!url) return ''
    try {
      const r = await limited(() => timed(url))
      if (!r.ok) return ''
      const buf = Buffer.from(await r.arrayBuffer())
      if (!buf.length || buf.length > maxImageBytes) return ''
      writeAtomic(file, buf)
      return buf
    } catch {
      return ''
    }
  }

  async function image(kind, entry) {
    if (kind !== 'poster' && kind !== 'preview') throw new Error(`未知图片类型 ${kind}`)
    if (!entry || !SLUG_RE.test(entry.slug)) return ''
    const file = path.join(dir, kind, `${entry.slug}.webp`)
    let buf = null
    try {
      buf = fs.readFileSync(file)
    } catch {
      const key = `${kind}:${entry.slug}`
      if (!inflight.has(key)) inflight.set(key, fetchImage(kind, entry, file).finally(() => inflight.delete(key)))
      buf = await inflight.get(key)
    }
    return buf && buf.length ? `data:image/webp;base64,${Buffer.from(buf).toString('base64')}` : ''
  }

  function status() {
    return { offline, lastError, all: entries?.length ?? 0 }
  }

  return { sync, ensure, image, status }
}
```

- [ ] **Step 4: 跑确认通过**

Run: `node --test plugins-dev/opus-gallery/lib/store.test.mjs`
Expected: PASS（6 tests）

- [ ] **Step 5: Commit**

```bash
git add plugins-dev/opus-gallery/lib/store.mjs plugins-dev/opus-gallery/lib/store.test.mjs
git commit -m "feat(opus-gallery): etag sync, offline fallback and image cache

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: MCP server 与清单

**Files:**
- Create: `plugins-dev/opus-gallery/plugin.json`
- Create: `plugins-dev/opus-gallery/server.mjs`
- Create: `plugins-dev/opus-gallery/ui/panel.html`（本任务只放占位 `<!doctype html><title>Opus 画廊</title>`，Task 5 写全）
- Create: `plugins-dev/opus-gallery/lib/server.test.mjs`

**Interfaces:**
- Consumes: Task 2 的 `CATEGORIES / filterPage / tagCounts / composeInjection / DEFAULT_PRESETS / savePreset / deletePreset`；Task 3 的 `createStore / DATA_URL / MEDIA_BASE`。
- Produces（Task 5 面板用，全部经 `tools/call`，结果在 `structuredContent`）：
  - `gallery_show {}` → `{ opened: true }`
  - `gallery_list { category?, tag?, page?, refresh? }` → `{ offline, lastError, all, categories, tags, page, pages, total, items: { slug, author, category, tags, partial }[] }`
  - `gallery_images { kind: 'poster'|'preview', slugs: string[≤12] }` → `{ images: Record<slug, dataURL | ''> }`
  - `gallery_detail { slug }` → `{ slug, author, postUrl, category, tags, partial, prompt, added }`
  - `gallery_compose { slug, topic, presetId? }` → `{ label, text }`
  - `gallery_presets {}` / `gallery_preset_save { id?, name, text }` / `gallery_preset_delete { id }` → `{ presets: Preset[] }`
  - 资源 `ui://opus-gallery/panel`，mimeType `text/html;profile=mcp-app`
  - 测试专用环境变量：`OPUS_GALLERY_DATA_URL`、`OPUS_GALLERY_MEDIA_BASE`（宿主 env 白名单不会传它们，线上走默认值）

- [ ] **Step 1: 写清单**

`plugins-dev/opus-gallery/plugin.json`（字段照 `resources/plugins/timeline/plugin.json`；`name` 必须等于目录名）：

```json
{
  "name": "opus-gallery",
  "displayName": "Opus 画廊",
  "description": "浏览 Opus 5.5 代码动画作品，点选后以它为风格参考，把指令挂到对话框。个人使用，不随安装包分发。",
  "category": "Creativity",
  "brandColor": "#A2B9E0",
  "mcp": { "command": "node", "args": ["./server.mjs"] },
  "panels": [
    { "id": "main", "title": "Opus 画廊", "tool": "gallery_show", "entry": "ui://opus-gallery/panel", "defaultSize": { "w": 900, "h": 720 } }
  ],
  "permissions": { "canvas": [] },
  "version": "0.1.0"
}
```

- [ ] **Step 2: 写失败的 server 测试**

`plugins-dev/opus-gallery/lib/server.test.mjs`：

```js
// 真 spawn server，本地起假上游，照 resources/plugins/timeline/lib/server.test.ts 的做法。
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const SERVER = fileURLToPath(new URL('../server.mjs', import.meta.url))

test('stdio：工具表、列表、图片、详情、注入、预设、面板资源', async (t) => {
  const up = http.createServer((req, res) => {
    const base = `http://127.0.0.1:${up.address().port}`
    if (req.url === '/videos.json') {
      res.setHeader('etag', '"v1"')
      return res.end(JSON.stringify([
        { slug: 'a-1', author: 'u1', category: 'motion', post_url: 'https://x.com/u1/status/1', poster_url: `${base}/p/a-1.webp`, prompt: '做一个粒子片头', prompt_partial: false, tech_tags: ['canvas'], added: '2026-09-20' },
        { slug: 'b-2', author: 'u2', category: '3d', post_url: '', poster_url: '', prompt: '3D 城市', prompt_partial: true, tech_tags: ['threejs'], added: '2026-09-21' }
      ]))
    }
    if (req.url === '/p/a-1.webp') return res.end('POSTER')
    if (req.url === '/m/a-1/preview.webp') return res.end('PREVIEW')
    res.statusCode = 404
    res.end()
  })
  await new Promise((r) => up.listen(0, '127.0.0.1', r))
  t.after(() => up.close())
  const base = `http://127.0.0.1:${up.address().port}`
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'opus-srv-'))
  t.after(() => fs.rmSync(data, { recursive: true, force: true }))

  const p = spawn(process.execPath, [SERVER], { env: { ...process.env, EAS_PLUGIN_DATA: data, OPUS_GALLERY_DATA_URL: `${base}/videos.json`, OPUS_GALLERY_MEDIA_BASE: `${base}/m` } })
  t.after(() => p.kill())
  const pending = new Map()
  let seq = 0
  createInterface({ input: p.stdout }).on('line', (l) => { const m = JSON.parse(l); pending.get(m.id)?.(m); pending.delete(m.id) })
  const rpc = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq
    const timer = setTimeout(() => reject(Error(`rpc timeout ${method}`)), 5000)
    pending.set(id, (m) => { clearTimeout(timer); resolve(m) })
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
  })
  const call = async (name, args = {}) => (await rpc('tools/call', { name, arguments: args })).result

  assert.equal((await rpc('initialize')).result.serverInfo.name, 'opus-gallery')
  const names = (await rpc('tools/list')).result.tools.map((x) => x.name)
  assert.deepEqual(names, ['gallery_show', 'gallery_list', 'gallery_images', 'gallery_detail', 'gallery_compose', 'gallery_presets', 'gallery_preset_save', 'gallery_preset_delete'])

  const list = (await call('gallery_list', {})).structuredContent
  assert.deepEqual([list.all, list.total, list.offline], [2, 2, false])
  assert.deepEqual(list.items.map((i) => i.slug), ['b-2', 'a-1'])
  assert.equal(list.items[0].prompt, undefined, '列表不带全文提示词')
  assert.equal((await call('gallery_list', { category: '3d' })).structuredContent.total, 1)

  const imgs = (await call('gallery_images', { kind: 'poster', slugs: ['a-1', 'b-2', 'nope'] })).structuredContent.images
  assert.equal(imgs['a-1'], 'data:image/webp;base64,' + Buffer.from('POSTER').toString('base64'))
  assert.deepEqual([imgs['b-2'], imgs.nope], ['', ''])
  const prev = (await call('gallery_images', { kind: 'preview', slugs: ['a-1'] })).structuredContent.images
  assert.equal(prev['a-1'], 'data:image/webp;base64,' + Buffer.from('PREVIEW').toString('base64'))
  assert.equal((await call('gallery_images', { kind: 'poster', slugs: Array(13).fill('a-1') })).isError, true)

  const d = (await call('gallery_detail', { slug: 'b-2' })).structuredContent
  assert.deepEqual([d.prompt, d.partial], ['3D 城市', true])
  assert.equal((await call('gallery_detail', { slug: 'zzz' })).isError, true)

  const presets = (await call('gallery_presets')).structuredContent.presets
  assert.equal(presets[0].id, 'eas-promo')
  const c = (await call('gallery_compose', { slug: 'a-1', topic: '笔纵发布', presetId: 'eas-promo' })).structuredContent
  assert.equal(c.label, '@u1 风格')
  assert.match(c.text, /为「笔纵发布」/)
  assert.match(c.text, /附加约束（Eas-Term 宣传片规范）/)
  assert.equal((await call('gallery_compose', { slug: 'a-1', topic: 'x', presetId: 'gone' })).isError, true)

  const saved = (await call('gallery_preset_save', { name: '克制', text: '少动' })).structuredContent.presets
  assert.equal(saved.length, 2)
  assert.ok(fs.existsSync(path.join(data, 'presets.json')))
  const left = (await call('gallery_preset_delete', { id: saved[1].id })).structuredContent.presets
  assert.equal(left.length, 1)

  const res = (await rpc('resources/read', { uri: 'ui://opus-gallery/panel' })).result.contents[0]
  assert.equal(res.mimeType, 'text/html;profile=mcp-app')
  assert.match(res.text, /<!doctype html>/i)
  assert.equal((await rpc('nope')).error.code, -32601)
})
```

- [ ] **Step 3: 跑确认失败**

Run: `node --test plugins-dev/opus-gallery/lib/server.test.mjs`
Expected: FAIL（`Cannot find module .../server.mjs` 或子进程立即退出导致 `rpc timeout initialize`）

- [ ] **Step 4: 写 server**

先建占位 `plugins-dev/opus-gallery/ui/panel.html`：

```html
<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>Opus 画廊</title></head><body></body></html>
```

`plugins-dev/opus-gallery/server.mjs`：

```js
#!/usr/bin/env node
// Opus 作品画廊 · MCP stdio server。手写极简 JSON-RPC（照 resources/plugins/timeline/server.mjs），零依赖。
// 个人插件：源码在 plugins-dev/，用 scripts/install-dev-plugin.sh 装到 ~/.eas/plugins/，不随安装包分发。
// 设计稿：docs/superpowers/specs/2026-09-28-opus-gallery-design.md
import readline from 'node:readline'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CATEGORIES, filterPage, tagCounts, composeInjection, DEFAULT_PRESETS, savePreset, deletePreset } from './lib/core.mjs'
import { createStore, DATA_URL, MEDIA_BASE } from './lib/store.mjs'

const URI = 'ui://opus-gallery/panel'
const MIME = 'text/html;profile=mcp-app'
const dir = process.env.EAS_PLUGIN_DATA || path.join(os.homedir(), '.eas', 'plugin-data', 'opus-gallery')
const store = createStore({ dir, dataUrl: process.env.OPUS_GALLERY_DATA_URL || DATA_URL, mediaBase: process.env.OPUS_GALLERY_MEDIA_BASE || MEDIA_BASE })
const presetsFile = path.join(dir, 'presets.json')

function loadPresets() {
  try {
    const v = JSON.parse(fs.readFileSync(presetsFile, 'utf8'))
    if (Array.isArray(v)) return v
  } catch {}
  return DEFAULT_PRESETS.map((p) => ({ ...p }))
}
function writePresets(list) {
  const tmp = `${presetsFile}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2))
  fs.renameSync(tmp, presetsFile)
  return { presets: list }
}

const str = { type: 'string' }
const obj = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false })
const TOOLS = [
  { name: 'gallery_show', description: '打开 Opus 作品画廊面板', inputSchema: obj(), _meta: { 'ui/resourceUri': URI } },
  { name: 'gallery_list', description: '按分类/技术标签分页列出作品（不含图片与全文提示词）', inputSchema: obj({ category: str, tag: str, page: { type: 'integer', minimum: 0 }, refresh: { type: 'boolean' } }) },
  { name: 'gallery_images', description: '取作品封面或预览动图（data URL），一次最多 12 个', inputSchema: obj({ kind: { type: 'string', enum: ['poster', 'preview'] }, slugs: { type: 'array', items: str, maxItems: 12 } }, ['kind', 'slugs']) },
  { name: 'gallery_detail', description: '取一件作品的完整信息与原提示词', inputSchema: obj({ slug: str }, ['slug']) },
  { name: 'gallery_compose', description: '以某件作品为风格参考、按主题拼出注入对话的指令', inputSchema: obj({ slug: str, topic: str, presetId: str }, ['slug', 'topic']) },
  { name: 'gallery_presets', description: '列出附加约束预设', inputSchema: obj() },
  { name: 'gallery_preset_save', description: '新建或更新附加约束预设', inputSchema: obj({ id: str, name: str, text: str }, ['name', 'text']) },
  { name: 'gallery_preset_delete', description: '删除附加约束预设', inputSchema: obj({ id: str }, ['id']) }
]

async function find(slug) {
  const e = (await store.ensure()).find((x) => x.slug === String(slug ?? ''))
  if (!e) throw new Error(`没有这件作品：${slug}`)
  return e
}

async function call(name, a = {}) {
  switch (name) {
    case 'gallery_show':
      return { opened: true }
    case 'gallery_list': {
      if (a.refresh) await store.sync()
      const all = await store.ensure()
      const pg = filterPage(all, a)
      return {
        ...store.status(),
        categories: CATEGORIES,
        tags: tagCounts(all),
        page: pg.page,
        pages: pg.pages,
        total: pg.total,
        items: pg.items.map((e) => ({ slug: e.slug, author: e.author, category: e.category, tags: e.tags, partial: e.partial }))
      }
    }
    case 'gallery_images': {
      const slugs = Array.isArray(a.slugs) ? a.slugs.map(String) : []
      if (slugs.length > 12) throw new Error('一次最多取 12 张')
      const all = await store.ensure()
      const pairs = await Promise.all(slugs.map(async (s) => {
        const e = all.find((x) => x.slug === s)
        return [s, e ? await store.image(a.kind, e) : '']
      }))
      return { images: Object.fromEntries(pairs) }
    }
    case 'gallery_detail': {
      const e = await find(a.slug)
      return { slug: e.slug, author: e.author, postUrl: e.postUrl, category: e.category, tags: e.tags, partial: e.partial, prompt: e.prompt, added: e.added }
    }
    case 'gallery_compose': {
      const e = await find(a.slug)
      const preset = a.presetId ? loadPresets().find((p) => p.id === a.presetId) : null
      if (a.presetId && !preset) throw new Error('这个附加约束预设已不存在，请重新选择')
      return composeInjection(e, a.topic, preset)
    }
    case 'gallery_presets':
      return { presets: loadPresets() }
    case 'gallery_preset_save':
      return writePresets(savePreset(loadPresets(), a))
    case 'gallery_preset_delete':
      return writePresets(deletePreset(loadPresets(), String(a.id ?? '')))
    default:
      throw new Error(`未知工具 ${name}`)
  }
}

const send = (m) => process.stdout.write(JSON.stringify(m) + '\n')

async function handle(m) {
  switch (m.method) {
    case 'initialize':
      return { protocolVersion: m.params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {}, resources: {} }, serverInfo: { name: 'opus-gallery', version: '0.1.0' } }
    case 'ping':
      return {}
    case 'tools/list':
      return { tools: TOOLS }
    case 'tools/call':
      try {
        const data = await call(m.params?.name, m.params?.arguments ?? {})
        return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data }
      } catch (e) {
        return { isError: true, content: [{ type: 'text', text: String(e?.message ?? e) }] }
      }
    case 'resources/list':
      return { resources: [{ uri: URI, name: 'Opus 画廊', mimeType: MIME }] }
    case 'resources/read':
      if (m.params?.uri !== URI) throw Object.assign(new Error('未知资源'), { code: -32602 })
      return { contents: [{ uri: URI, mimeType: MIME, text: fs.readFileSync(fileURLToPath(new URL('./ui/panel.html', import.meta.url)), 'utf8') }] }
    default:
      throw Object.assign(new Error('不支持的方法'), { code: -32601 })
  }
}

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  let m
  try {
    m = JSON.parse(line)
  } catch {
    return
  }
  if (m.id === undefined) return
  handle(m).then(
    (result) => send({ jsonrpc: '2.0', id: m.id, result }),
    (e) => send({ jsonrpc: '2.0', id: m.id, error: { code: e.code ?? -32603, message: String(e?.message ?? e) } })
  )
})
```

- [ ] **Step 5: 跑确认通过**

Run: `node --test plugins-dev/opus-gallery/lib/server.test.mjs`
Expected: PASS

注意：本机开着 Clash TUN，测试只连 `127.0.0.1`，不受影响；若超时先看是不是端口被代理接管（全局 CLAUDE.md 排障套路）。

- [ ] **Step 6: Commit**

```bash
git add plugins-dev/opus-gallery/plugin.json plugins-dev/opus-gallery/server.mjs plugins-dev/opus-gallery/ui/panel.html plugins-dev/opus-gallery/lib/server.test.mjs
git commit -m "feat(opus-gallery): mcp stdio server and manifest

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: 面板 `panel.html`

**Files:**
- Modify: `plugins-dev/opus-gallery/ui/panel.html`（替换 Task 4 的占位）
- Create: `plugins-dev/opus-gallery/lib/panel.test.mjs`

**Interfaces:**
- Consumes: Task 4 的全部工具；宿主 `ui/initialize`（返回 `hostContext`，主题在 `hostContext.theme`）、`ui/open-link { url }`、Task 1 的 `ui/message { role, content, _meta.eas.label }`；宿主通知 `ui/notifications/host-context-changed`。
- Produces: 用户可见的面板，无程序接口。
- 动手前先读 `src/renderer/src/features/plugins/appsProtocol.ts` 的 `initializeResult`，确认主题字段确实在 `hostContext.theme`（取值 `dark`/`light`）；字段名不同就改面板里的 `theme()`。

- [ ] **Step 1: 写失败的静态约束测试**

`plugins-dev/opus-gallery/lib/panel.test.mjs`：

```js
// 面板跑在 iframe 里、CSP 锁死，逻辑靠 Task 6 真机验证；这里只钉住不能违反的约束。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const html = fs.readFileSync(new URL('../ui/panel.html', import.meta.url), 'utf8')

test('面板约束：第三方内容不走 innerHTML、不外连、体积在宿主上限内、用了 ui/message', () => {
  assert.doesNotMatch(html, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/)
  assert.doesNotMatch(html, /\b(src|href)=["']https?:/)
  assert.doesNotMatch(html, /<form/i, 'CSP form-action none')
  assert.ok(Buffer.byteLength(html) < 512 * 1024)
  assert.match(html, /rpc\('ui\/message'/)
  assert.match(html, /rpc\('ui\/open-link'/)
  assert.match(html, /gallery_images/)
})
```

- [ ] **Step 2: 跑确认失败**

Run: `node --test plugins-dev/opus-gallery/lib/panel.test.mjs`
Expected: FAIL（占位文件里没有 `ui/message`）

- [ ] **Step 3: 写面板**

`plugins-dev/opus-gallery/ui/panel.html` 全文：

```html
<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>Opus 画廊</title>
<style>
:root{--bg:#16171a;--panel:#1d1f23;--line:#2c2f35;--fg:#e6e7ea;--dim:#9a9ea8;--accent:#a2b9e0;--on-accent:#12141a;--danger:#e0a2a2}
[data-theme=light]{--bg:#f6f6f4;--panel:#fff;--line:#e2e2de;--fg:#1d1f23;--dim:#6b6f78;--accent:#3b5b92;--on-accent:#fff;--danger:#a33}
*{box-sizing:border-box}
html,body{margin:0;height:100%;background:var(--bg);color:var(--fg);font:13px/1.5 -apple-system,"PingFang SC",sans-serif}
button,input,select,textarea{font:inherit;color:inherit}
input,select,textarea{background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:4px 8px}
button{cursor:pointer}
.ghost{background:none;border:1px solid var(--line);border-radius:6px;padding:4px 10px}
.act{background:var(--accent);color:var(--on-accent);border:0;border-radius:6px;padding:6px 14px}
.act:disabled,.ghost:disabled{opacity:.4;cursor:default}
#app{display:grid;grid-template-rows:auto 1fr auto auto;height:100%}
header{display:flex;gap:6px;align-items:center;padding:10px 12px;border-bottom:1px solid var(--line);flex-wrap:wrap}
.tab{background:none;border:1px solid transparent;color:var(--dim);padding:4px 10px;border-radius:6px}
.tab[aria-selected=true]{color:var(--fg);border-color:var(--line);background:var(--panel)}
#status{margin-left:auto;color:var(--dim);font-size:12px}
main{display:grid;grid-template-columns:1fr;min-height:0}
main.open{grid-template-columns:1fr 320px}
#left{display:grid;grid-template-rows:1fr auto;min-height:0}
#grid{overflow:auto;padding:12px;display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;align-content:start}
.card{background:var(--panel);border:1px solid var(--line);border-radius:8px;overflow:hidden;padding:0;text-align:left}
.card[aria-current=true]{outline:2px solid var(--accent)}
.card img{display:block;width:100%;aspect-ratio:16/10;object-fit:cover;background:var(--line)}
.card .meta{padding:6px 8px;font-size:12px}
.card .tags{color:var(--dim);font-size:11px}
.empty{grid-column:1/-1;color:var(--dim);padding:40px;text-align:center}
#pager{display:flex;gap:8px;align-items:center;justify-content:center;padding:6px;color:var(--dim)}
#detail{display:none;border-left:1px solid var(--line);overflow:auto;padding:12px}
main.open #detail{display:block}
#d-img{display:block;width:100%;aspect-ratio:16/10;object-fit:cover;border-radius:6px;background:var(--line)}
#d-head{display:flex;gap:6px;align-items:center;margin:8px 0}
.badge{font-size:11px;border:1px solid var(--line);border-radius:4px;padding:0 4px;color:var(--dim)}
#d-prompt{white-space:pre-wrap;font-size:12px;background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:8px;max-height:300px;overflow:auto;margin:8px 0}
footer{display:flex;gap:8px;align-items:center;padding:10px 12px;border-top:1px solid var(--line)}
#topic{flex:1;min-width:0}
#notice{padding:0 12px 8px;font-size:12px;color:var(--dim);min-height:1.5em}
#notice.err{color:var(--danger)}
dialog{background:var(--panel);color:var(--fg);border:1px solid var(--line);border-radius:10px;width:440px}
dialog .row{display:flex;gap:8px;margin-bottom:8px;align-items:center}
dialog input{flex:1}
dialog textarea{width:100%;height:200px;resize:vertical}
</style>
</head>
<body>
<div id="app">
  <header>
    <div id="tabs" role="tablist"></div>
    <select id="tag" aria-label="技术标签"></select>
    <button class="ghost" id="refresh">刷新</button>
    <span id="status"></span>
  </header>
  <main>
    <div id="left">
      <div id="grid"></div>
      <div id="pager"><button class="ghost" id="prev">上一页</button><span id="pageinfo"></span><button class="ghost" id="next">下一页</button></div>
    </div>
    <aside id="detail">
      <img id="d-img" alt="">
      <div id="d-head"><strong id="d-author"></strong><span class="badge" id="d-partial" hidden>仅部分公开</span></div>
      <div class="tags" id="d-tags"></div>
      <pre id="d-prompt"></pre>
      <button class="ghost" id="d-link">看原帖</button>
      <button class="ghost" id="d-close">收起</button>
    </aside>
  </main>
  <footer>
    <input id="topic" placeholder="你的主题，例如：Eas-Term 的无限画布" maxlength="200">
    <select id="preset" aria-label="附加约束"></select>
    <button class="ghost" id="edit-presets">编辑约束</button>
    <button class="act" id="use" disabled>用它做</button>
  </footer>
  <div id="notice"></div>
</div>
<dialog id="pd">
  <div class="row"><select id="pd-pick"></select></div>
  <div class="row"><input id="pd-name" placeholder="名称（1–30 字）" maxlength="30"></div>
  <textarea id="pd-text" placeholder="约束内容，会原样附在注入指令末尾"></textarea>
  <div class="row" style="justify-content:flex-end;margin-top:8px">
    <button class="ghost" id="pd-del">删除</button>
    <button class="ghost" id="pd-cancel">关闭</button>
    <button class="act" id="pd-save">保存</button>
  </div>
</dialog>
<script>
const $ = (s) => document.querySelector(s)
const el = (tag, props = {}, kids = []) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n }
const S = { category: '', tag: '', page: 0, pages: 1, sel: null, presets: [], posters: new Map(), previews: new Map(), gen: 0, detailUrl: '' }

// ── 宿主协议（MCP Apps postMessage）──
let seq = 0
const pending = new Map()
function rpc(method, params) {
  return new Promise((resolve, reject) => {
    const id = ++seq
    const timer = setTimeout(() => { pending.delete(id); reject(Error('宿主响应超时，请点「刷新」重试')) }, 30000)
    pending.set(id, { resolve, reject, timer })
    parent.postMessage({ jsonrpc: '2.0', id, method, params }, '*')
  })
}
async function tool(name, args = {}) {
  const r = await rpc('tools/call', { name, arguments: args })
  if (r?.isError) throw Error(r.content?.[0]?.text || '工具调用失败')
  return r.structuredContent ?? JSON.parse(r.content[0].text)
}
window.addEventListener('message', (e) => {
  if (e.source !== parent || e.data?.jsonrpc !== '2.0') return
  const m = e.data
  const p = pending.get(m.id)
  if (p) { clearTimeout(p.timer); pending.delete(m.id); m.error ? p.reject(Error(m.error.message)) : p.resolve(m.result); return }
  if (m.method === 'ui/notifications/host-context-changed') theme(m.params)
})
function theme(ctx) { if (ctx?.theme) document.documentElement.dataset.theme = ctx.theme }
function note(msg, err = false) { const n = $('#notice'); n.textContent = msg || ''; n.className = err ? 'err' : '' }

// ── 列表 ──
async function load(refresh = false) {
  note(refresh ? '正在和上游同步…' : '加载中…')
  try {
    const r = await tool('gallery_list', { category: S.category, tag: S.tag, page: S.page, refresh })
    S.page = r.page; S.pages = r.pages
    renderTabs(r.categories); renderTags(r.tags); renderGrid(r.items)
    $('#pageinfo').textContent = `${r.page + 1} / ${r.pages}（${r.total} 件）`
    $('#prev').disabled = r.page <= 0; $('#next').disabled = r.page >= r.pages - 1
    $('#status').textContent = r.offline ? `离线，显示上次同步的 ${r.all} 件` : `共 ${r.all} 件`
    note(r.offline ? `没连上上游（${r.lastError}），用的是本地缓存` : '')
    loadPosters(r.items.map((i) => i.slug))
  } catch (e) {
    $('#grid').replaceChildren(el('div', { className: 'empty' }, [
      el('p', { textContent: e.message }),
      el('button', { className: 'ghost', textContent: '重试', onclick: () => load(true) })
    ]))
    note('')
  }
}
function renderTabs(cats) {
  const all = [{ id: '', label: '全部' }, ...cats]
  $('#tabs').replaceChildren(...all.map((c) => el('button', {
    className: 'tab', textContent: c.label, role: 'tab', ariaSelected: String(c.id === S.category),
    onclick: () => { S.category = c.id; S.page = 0; load() }
  })))
}
function renderTags(tags) {
  const sel = $('#tag')
  sel.replaceChildren(el('option', { value: '', textContent: '全部技术' }), ...tags.map((t) => el('option', { value: t.tag, textContent: `${t.tag}（${t.count}）` })))
  sel.value = S.tag
}
function renderGrid(items) {
  if (!items.length) { $('#grid').replaceChildren(el('div', { className: 'empty', textContent: '这个筛选下没有作品' })); return }
  $('#grid').replaceChildren(...items.map((i) => {
    const img = el('img', { alt: '', loading: 'lazy' })
    if (S.posters.get(i.slug)) img.src = S.posters.get(i.slug)
    const card = el('button', { className: 'card', onclick: () => select(i.slug) }, [
      img,
      el('div', { className: 'meta' }, [el('div', { textContent: '@' + i.author }), el('div', { className: 'tags', textContent: i.tags.join(' · ') })])
    ])
    card.dataset.slug = i.slug
    if (i.slug === S.sel) card.setAttribute('aria-current', 'true')
    let t = 0
    card.addEventListener('mouseenter', () => { t = setTimeout(() => hover(card, true), 250) })
    card.addEventListener('mouseleave', () => { clearTimeout(t); hover(card, false) })
    return card
  }))
}
async function loadPosters(slugs) {
  const gen = ++S.gen
  const need = slugs.filter((s) => !S.posters.has(s))
  for (let i = 0; i < need.length; i += 6) {
    if (gen !== S.gen) return
    try {
      const r = await tool('gallery_images', { kind: 'poster', slugs: need.slice(i, i + 6) })
      for (const [slug, url] of Object.entries(r.images)) { if (url) S.posters.set(slug, url); paint(slug) }
    } catch {}
  }
}
function paint(slug) {
  const img = document.querySelector(`.card[data-slug="${CSS.escape(slug)}"] img`)
  if (img && !img.dataset.hover && S.posters.get(slug)) img.src = S.posters.get(slug)
}
async function preview(slug) {
  if (!S.previews.has(slug)) {
    try { S.previews.set(slug, (await tool('gallery_images', { kind: 'preview', slugs: [slug] })).images[slug] || '') } catch { return '' }
  }
  return S.previews.get(slug)
}
async function hover(card, on) {
  const slug = card.dataset.slug
  const img = card.querySelector('img')
  if (!on) { delete img.dataset.hover; if (S.posters.get(slug)) img.src = S.posters.get(slug); return }
  img.dataset.hover = '1'
  const url = await preview(slug)
  if (url && img.dataset.hover) img.src = url
}

// ── 详情 ──
async function select(slug) {
  S.sel = slug
  document.querySelectorAll('.card').forEach((c) => c.toggleAttribute('aria-current', c.dataset.slug === slug))
  $('main').classList.add('open')
  $('#d-img').src = S.posters.get(slug) || ''
  $('#d-prompt').textContent = '加载中…'
  syncUse()
  try {
    const d = await tool('gallery_detail', { slug })
    if (S.sel !== slug) return
    $('#d-author').textContent = '@' + d.author
    $('#d-partial').hidden = !d.partial
    $('#d-tags').textContent = d.tags.join(' · ')
    $('#d-prompt').textContent = d.prompt
    S.detailUrl = d.postUrl
    $('#d-link').disabled = !d.postUrl
    const url = await preview(slug)
    if (url && S.sel === slug) $('#d-img').src = url
  } catch (e) { note(e.message, true) }
}
$('#d-link').onclick = () => { if (S.detailUrl) rpc('ui/open-link', { url: S.detailUrl }).catch((e) => note(e.message, true)) }
$('#d-close').onclick = () => { S.sel = null; $('main').classList.remove('open'); document.querySelectorAll('.card').forEach((c) => c.removeAttribute('aria-current')); syncUse() }

// ── 注入 ──
function syncUse() { $('#use').disabled = !(S.sel && $('#topic').value.trim()) }
$('#topic').addEventListener('input', syncUse)
$('#use').onclick = async () => {
  const topic = $('#topic').value.trim()
  if (!S.sel || !topic) return
  $('#use').disabled = true
  try {
    const c = await tool('gallery_compose', { slug: S.sel, topic, ...($('#preset').value ? { presetId: $('#preset').value } : {}) })
    await rpc('ui/message', { role: 'user', content: [{ type: 'text', text: c.text }], _meta: { eas: { label: c.label } } })
    note(`已挂到对话框：${c.label}。补几句需求后发送即可。`)
  } catch (e) { note(e.message, true) } finally { syncUse() }
}

// ── 附加约束预设 ──
async function loadPresets(keep) {
  const r = await tool('gallery_presets')
  S.presets = r.presets
  const cur = keep ?? $('#preset').value
  $('#preset').replaceChildren(el('option', { value: '', textContent: '不附加约束' }), ...S.presets.map((p) => el('option', { value: p.id, textContent: p.name })))
  $('#preset').value = S.presets.some((p) => p.id === cur) ? cur : ''
}
function fillDialog(id) {
  const p = S.presets.find((x) => x.id === id)
  $('#pd-pick').value = p ? p.id : ''
  $('#pd-name').value = p ? p.name : ''
  $('#pd-text').value = p ? p.text : ''
  $('#pd-del').disabled = !p
}
$('#edit-presets').onclick = () => {
  $('#pd-pick').replaceChildren(el('option', { value: '', textContent: '＋ 新建约束' }), ...S.presets.map((p) => el('option', { value: p.id, textContent: p.name })))
  fillDialog($('#preset').value)
  $('#pd').showModal()
}
$('#pd-pick').onchange = () => fillDialog($('#pd-pick').value)
$('#pd-cancel').onclick = () => $('#pd').close()
$('#pd-save').onclick = async () => {
  try {
    const id = $('#pd-pick').value || undefined
    const r = await tool('gallery_preset_save', { ...(id ? { id } : {}), name: $('#pd-name').value, text: $('#pd-text').value })
    const saved = id ? id : r.presets[r.presets.length - 1].id
    await loadPresets(saved)
    $('#pd').close()
    note('约束已保存')
  } catch (e) { note(e.message, true) }
}
$('#pd-del').onclick = async () => {
  const id = $('#pd-pick').value
  if (!id) return
  try { await tool('gallery_preset_delete', { id }); await loadPresets(); $('#pd').close(); note('约束已删除') } catch (e) { note(e.message, true) }
}

// ── 顶部控件 ──
$('#tag').onchange = () => { S.tag = $('#tag').value; S.page = 0; load() }
$('#refresh').onclick = () => load(true)
$('#prev').onclick = () => { S.page--; load() }
$('#next').onclick = () => { S.page++; load() }

// ── 握手 ──
;(async () => {
  try {
    const r = await rpc('ui/initialize', { appInfo: { name: 'opus-gallery', version: '0.1.0' }, appCapabilities: {}, protocolVersion: '2026-01-26' })
    theme(r?.hostContext)
    parent.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/initialized' }, '*')
    await Promise.all([load(), loadPresets()])
  } catch (e) { note('和宿主握手失败：' + e.message, true) }
})()
</script>
</body>
</html>
```

- [ ] **Step 4: 跑确认通过**

Run: `node --test plugins-dev/opus-gallery/lib/panel.test.mjs plugins-dev/opus-gallery/lib/server.test.mjs`
Expected: PASS（server 测试里 `resources/read` 现在读到的是真面板）

- [ ] **Step 5: Commit**

```bash
git add plugins-dev/opus-gallery/ui/panel.html plugins-dev/opus-gallery/lib/panel.test.mjs
git commit -m "feat(opus-gallery): gallery panel with hover preview and injection

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: 安装脚本 + 真机验证

**Files:**
- Create: `scripts/install-dev-plugin.sh`
- Modify: `docs/superpowers/specs/2026-09-28-opus-gallery-design.md`（顶部加「状态：A 期已实现，验证记录见计划 Task 6」一行）

**Interfaces:**
- Consumes: Task 1–5 全部产物。
- Produces: `~/.eas/plugins/opus-gallery/` 已安装的插件；真机截图与验证结论。

- [ ] **Step 1: 写安装脚本**

`scripts/install-dev-plugin.sh`：

```bash
#!/usr/bin/env bash
# 把 plugins-dev/<name>/ 装到 ~/.eas/plugins/<name>/：逐个文件拷（不带测试），拷完逐个核对大小。
# 个人插件不进安装包；装完要**关掉再重开面板**，已在跑的插件进程不会换代码。
set -euo pipefail
name="${1:?用法: scripts/install-dev-plugin.sh <插件名>}"
root="$(cd "$(dirname "$0")/.." && pwd)"
src="$root/plugins-dev/$name"
dst="$HOME/.eas/plugins/$name"
[ -f "$src/plugin.json" ] || { echo "没有 $src/plugin.json" >&2; exit 1; }
mkdir -p "$dst"
cd "$src"
find . -type f ! -name '*.test.*' ! -name '.DS_Store' | sort | while read -r f; do
  mkdir -p "$dst/$(dirname "$f")"
  cp "$f" "$dst/$f"
  a=$(wc -c < "$f" | tr -d ' ')
  b=$(wc -c < "$dst/$f" | tr -d ' ')
  [ "$a" = "$b" ] || { echo "大小不一致: $f ($a vs $b)" >&2; exit 1; }
  echo "  $f  $a"
done
echo "已装到 $dst —— 关掉再重开画廊面板生效"
```

Run: `chmod +x scripts/install-dev-plugin.sh && scripts/install-dev-plugin.sh opus-gallery`
Expected: 列出 `./plugin.json ./server.mjs ./lib/core.mjs ./lib/store.mjs ./ui/panel.html` 五个文件及字节数，最后一行「已装到 …」。

- [ ] **Step 2: 全量测试**

Run: `npm test`
Expected: 全绿。有失败原样记录，不粉饰；若失败与本分支无关（主线原有），用 `git stash` 以外的方式确认——在干净的 `origin/main` worktree 跑同一条测试对照。

- [ ] **Step 3: 构建并打开应用（open-app-verify skill）**

用 `open-app-verify` skill 构建本 worktree 的应用并打开。验证方法照记忆「Eas-Term CDP 验证方法」（注意窗口尺寸、首启弹窗、孤儿实例、发消息选对输入框）。宿主改动（Task 1）只有从本 worktree 构建的版本才有，**不能用 /Applications 里的正式版验证**。

- [ ] **Step 4: 走主路径并截图**

1. Frame 右键 →「插件」→ 选「Opus 画廊」，面板出现在画布上。截图 1。
2. 首次打开：状态显示「共 389 件」（或当天实际数），封面按批渐进出现。
3. 切「3D」页签、选 `threejs` 标签，数量与页码变化正确。
4. 鼠标停在一张卡片上 ≥250ms，封面换成预览动图；移开恢复。
5. 点一张卡片，右侧详情出现：作者、标签、全文提示词，「看原帖」能在画布里打开 X 帖子。截图 2。
6. 先点一下某个 AI 对话的输入框，再回面板输入主题「Eas-Term 的无限画布」，约束选「Eas-Term 宣传片规范」，点「用它做」。对话输入框上方出现 chip「Opus 画廊 · @作者 风格」。截图 3。
7. 在输入框补一句话后发送，确认 AI 收到的消息里有展开的全文（模板 + 原提示词 + 约束）。

- [ ] **Step 5: 走失败路径**

1. 重启应用后**不点任何对话框**，直接在面板点「用它做」→ 面板底部红字「没有可注入的对话框，先点一下要注入的对话框」，终端里没有任何输入。截图 4。
2. 断网（关 Wi-Fi）后点「刷新」→ 状态「离线，显示上次同步的 N 件」，已缓存封面仍显示。
3. 删掉 `userData/plugin-data/opus-gallery/` 后断网打开面板 → 网格显示「拉取作品清单失败：…」和「重试」按钮。
4. 编辑约束：新建一条、改名、删除，下拉同步变化；重开面板后仍在。

没亲眼看到的步骤，在交付说明里逐条标「未验证」。

- [ ] **Step 6: 更新 spec 状态并 Commit**

在 spec 标题下一行加：`状态：A 期已实现（2026-09-28 计划 Task 6 真机验证）`。

```bash
git add scripts/install-dev-plugin.sh docs/superpowers/specs/2026-09-28-opus-gallery-design.md
git commit -m "chore(opus-gallery): dev plugin installer and verification record

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 7: 合并前检查（不在本计划内合并）**

跑 Eas-Term MCP 的 `merge_preflight`，重点看与 `feat/composer-assist-20260928` 在 `PluginPanel.tsx` / chip 通道上的冲突。结论交给用户决定合并时机。
