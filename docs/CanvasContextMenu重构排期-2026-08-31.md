# CanvasContextMenu 搬家排期

> 结论先行：**值得做，但要拆三步，且前两步都不许碰类名。**
> 第三步（改类名）没有强需求就别做 —— 收益是命名整洁，代价是踩一个已知的静默失效面。

## 为什么要动它

`src/renderer/src/features/canvas/CanvasContextMenu.tsx` 是**事实上的全局公共组件**，
却住在 canvas 这块地里。被 6 个 canvas 之外的 feature 依赖：
agentChat · workspace · terminal · gantt · files · git。

代码自己早就承认了这件事 —— `features/gantt/GanttJumpMenu.tsx` 的注释里直接管它叫
**「那个通用组件」**。认知一直在，只是没落实到位置上。

## 好消息：搬迁成本比想象低

| | |
|---|---|
| 体量 | 261 行，单文件 |
| 自身依赖 | 只有 `react` / `react-dom` / `./fuzzy` —— **不依赖任何 canvas 状态或类型** |
| 目的地约定 | `ui/` 用命名式导出（`export function Xxx()`）、组件不各自 import css，与它现状一致 |

## 它的导出面比"一个组件"宽（这点最容易低估）

| 导出 | 类型 | 谁在用 |
|---|---|---|
| `CanvasContextMenu` | 组件 | 10 处：MessageList · AgentChatView · Sidebar · TerminalInput · CanvasDrawer · CanvasSkillPanel(×2) · CanvasStage · HtmlOpenChoice · FileTree · HistoryView |
| `useMenuAnchor` | hook | 6 处：ModeSwitch · FrameStatusPicker · AgentCmdBar · CanvasFilePicker · CanvasAgentBar · GanttJumpMenu |
| `useDismiss` | hook | 与上重叠若干 |
| `CanvasMenuItem` / `MenuHeader` | 类型 | projectMenu.ts · stageMenu.ts |

**有 6 个文件只用 hook 不用组件** —— 只搬组件不搬 hook，等于把一个文件拆成两处依赖，
比不搬更糟。要搬就整份搬。

## ⚠️ 唯一的陷阱：`.canvas-ctxmenu` 这个类名被逻辑依赖

它不只是个样式类名，有 4 处代码按它做判断：

| 位置 | 用途 | 改名后的症状 |
|---|---|---|
| `features/canvas/menuOwnership.ts` 的 `OVERLAY_SELECTOR` | 判断右键落在哪一层 | 右键归属判错，弹错菜单 |
| `features/canvas/CanvasDrawer.tsx` | 点击外部关闭的排除项 | 点菜单会把抽屉关掉 |
| `features/canvas/CanvasWikiDrawer.tsx` | 同上 | 同上 |
| `features/canvas/menuOwnership.test.ts` | 测试固定值 | 测试红（这是唯一会喊出来的） |

`menuOwnership.test.ts` 开篇第一句就写着：

> 右键归属。**这一层原来一条测试都没有**，而它的坏法是静默的：
> 漏掉一个选择器，右键照样弹一个菜单，只是弹错了那个。

样式本身在 `features/canvas/canvas.css`（主规则 + 子菜单 `.cctx-sub`）。

## 三步走

### 第 1 步 · 搬组件（低风险，建议做）

- `features/canvas/CanvasContextMenu.tsx` → `ui/ContextMenu.tsx`
- `features/canvas/fuzzy.ts` + `fuzzy.test.ts` 一起搬（只有它在用；`features/dict/search.ts`
  的注释专门解释过为什么不能复用 `fuzzyPick`，所以不存在第二个用户）
- 更新全部 import 路径
- **类名、CSS 位置、导出名一律不动**（导出名可保留 `CanvasContextMenu` 或加一行
  `export { ContextMenu as CanvasContextMenu }` 过渡）

验证：`npm run check`（typecheck 会挡住所有漏改的 import）+ `npm run verify` 打开右键菜单看一眼。

### 第 2 步 · 搬样式（中风险，可选）

把 `.canvas-ctxmenu` / `.cctx-sub` 规则从 `features/canvas/canvas.css` 挪到全局样式。
**类名仍然不改。** 风险在 CSS 层叠顺序，验证靠肉眼看菜单样式没塌。

### 第 3 步 · 改类名（高风险，非必要不做）

`.canvas-ctxmenu` → `.ui-ctxmenu`，必须同步上面那张表的 4 处。
做之前先确认 `menuOwnership.test.ts` 是绿的，改完必须再跑一次 —— 那是唯一的安全网。

**我的建议：停在第 1 步或第 2 步。** 第 3 步的收益纯粹是命名整洁，
而 `.canvas-` 前缀留在那儿最多让人多看一眼注释，不会让任何人做错事。

## 不做也可以

如果近期不打算动 canvas，把这份排期留着即可。当前状态**不是 bug**，
只是一个已知的、有记录的架构瑕疵 —— [10-模块领地图](architecture/10-模块领地图.md)
的耦合警报里已经标着它，AI 动手前会看到。
