# Eas-Term 图标接入子任务报告

## 完成范围

- 新增 `src/renderer/src/ui/SemanticIcons.tsx`：按已批准原型实现 22 个原创双色 SVG 语义图标，统一 `24 × 24` viewBox、`1.65px` 描边和 SVG props。
- 在 `styles/base.css` 增加深浅主题色 token；深色与亮色分别使用原型色值，不复用浅色值。
- 新增 `semanticIconKinds.ts` 纯文件名映射，并接入共享 `FileTree`。项目侧栏、CanvasDrawer 等所有复用 FileTree 的入口会同时获得文件类型、目录开合和新建占位图标。
- 映射覆盖：`afterPack.js`/JS、PNG/ICNS 等图片、SVG 矢量、plist/config、AGENTS.md/CLAUDE.md、TS/TSX、Markdown、JSON、Git 文件以及 unknown fallback。
- `BranchBadge` 改用 worktree 图标；存在 overlap 时使用 warning 图标，tooltip 仍明确表达“其他分支改同一文件”，没有改为 Git 冲突语义。
- `CanvasMenuItem` 新增可选 `leadingIcon`，渲染在标签左侧；右侧 `icon ?? hint` 逻辑原样保留，因此 leadingIcon 不覆盖 hint。
- 公共 `ChatEvent` 新增可选 `ExecKind`，贯通 reducer 与 history。旧事件/旧历史缺字段时保持 `undefined`，UI 应回退 generic。
- Codex 按真实 item type 分类；Claude 按真实 tool name 分类；omp 只在 ACP `kind === 'execute'` 时认作 terminal，其余 generic。没有从 label、命令文本或自然语言猜测。

## 事件分类

| 来源 | 可靠字段 | 分类 |
|---|---|---|
| Codex | `command_execution` | `terminal` |
| Codex | `file_change` | `edit` |
| Codex | `web_search` | `search` |
| Codex | `mcp_tool_call` | `integration` |
| Claude | `Bash` | `terminal` |
| Claude | `Read` | `read` |
| Claude | `Write` / `Edit` / `NotebookEdit` | `edit` |
| Claude | `Glob` / `Grep` / `WebSearch` / `WebFetch` | `search` |
| Claude | `mcp__*` | `integration` |
| omp | ACP `kind: execute` | `terminal` |
| 所有来源 | 未识别 | `generic` |

## Root 集成接口

Root 拥有 `AgentChatView.tsx`、`MessageList.tsx`、`ChatToolbar.tsx` 和 `agentChat.css`，请在这些文件完成以下最小接线。

### ExecRow

```tsx
import { SemanticIcon } from '../../ui/SemanticIcons'

<SemanticIcon kind={item.kind ?? 'generic'} size={15} />
```

类型图标应放在当前状态标识旁，但不能替代 `item.state` 的运行/成功/失败文字或状态符号。

### CompactDivider

```tsx
<SemanticIcon kind="compact" size={15} />
```

只在已有 compacted 分隔记录中显示；不要构造“正在压缩”状态。

### 启动位置

```tsx
<SemanticIcon kind={worktree ? 'worktree' : 'folder'} size={13} />
```

已创建 worktree 的分支徽标已由 `BranchBadge` 接好。待创建状态可使用 `worktree`，但文案仍需明确“待创建”；本地目录用 `folder`。

### Worktree 菜单

```tsx
import { SemanticIcon } from '../../ui/SemanticIcons'

{ label: '打开终端', leadingIcon: <SemanticIcon kind="terminal" size={14} />, hint: '…', onClick }
{ label: '合并', leadingIcon: <SemanticIcon kind="merge" size={14} />, onClick }
```

`leadingIcon` 与 `hint` 可同时提供。现有禁删、确认、活跃会话 disabled 和脏工作区保护无需变化。

## 验证

- `npx tsc --noEmit -p tsconfig.node.json`：通过。
- `npx tsc --noEmit -p tsconfig.web.json`：通过。
- 定向 Node 测试：168/168 通过，覆盖三种 CLI 分类、未知 fallback、reducer 可选字段、历史保留/旧数据兼容和精确文件名映射。
- `git diff --check`：通过。

遵照任务限制，没有安装依赖、没有运行 Electron build、没有提交 commit，也没有修改 root 明确保留的聊天 UI 文件。
