# 终端 Git 集成方案（Vibe Coding 闭环）

> 立项日期：2026-07-09。项目：Eas-Term（多终端 + 项目浏览的桌面工作台，为 Vibe Coding 服务）。
> 本文件是跨会话唤醒锚点。开工/复盘前先读这里。

## 一、目标：把四个需求串成一条闭环

用户在终端里跑 Claude Code 等 AI，AI 改磁盘文件。四个需求本质是一条回路，分开做各自半成品，串起来才是护城河：

```
AI 改代码 → ①实时 diff 高亮 → ②点击查看改了啥 → ③可视化 Git 管理/回退 → ④回退后 AI 同步感知 → AI 接着改
```

- **需求①②**：像 IDE 一样显示新增/删除代码（绿增红删），点击文件看 diff。
- **需求③**：可视化 Git 版本管理（用户口语叫「插件」，实为一个功能模块）。
- **需求④（多想两步）**：GUI 里做 git 回退时，让终端里的 Claude Code 同步感知——否则 AI 认知停在旧代码，会基于过时记忆瞎改（Edit old_string 匹配失败等）。

## 二、已定决策（2026-07-09 用选项卡拍板）

1. ~~Git 做成第 4 种 PaneKind~~ → **改版：Git 放侧栏「资源管理器」区做成标签**（文件 ↔ 版本）。源代码管理属于侧栏，diff 才占主区域（VS Code 正解）。点变更文件 → diff 开在主区域代码面板。主面板下拉框**不含**源代码管理。
2. **每个版本的简约描述 = 混合模式**：历史默认显示 commit message；每条带「AI 总结」按钮，点了才把该次 diff 交给 **终端里的 `claude` CLI**（`claude -p`，复用 Claude Max，无需 API key、不额外计费）翻成一句中文人话，替换显示、原信息灰色保留。
3. **让 Claude Code 感知回退 = Hook 深度集成（主）**。回退时写 `.easterm/events.json`；Claude Code 的 `UserPromptSubmit` hook 下一轮读取并注入 additionalContext。PTY 注入/手动按钮兜底。（阶段二做）

## 三、三阶段路线

### 阶段一：源代码管理面板 + diff 查看（覆盖 ①②③ 主体）— **下一步开工**
- 主进程新增 `src/main/git.ts`（仿 `fs.ts` 用 `execFile('git',…)`），注册 `git:*`：
  `isRepo` / `status`（解析 `git status --porcelain=v2 --branch`）/ `diffFile`（`git diff [--cached] -- <path>`）/ `stage` / `unstage` / `discard` / `commit`；`log` 留给阶段二。
- `src/main/index.ts` 注册 `registerGitHandlers()`。
- `src/shared/types.ts` 加 `GitStatus / GitFileEntry / GitDiff` 等类型。
- `src/preload/index.ts` 加 `api.git.*` 桥接。
- `layout.ts`：`PaneKind` 加 `'git'`，`PaneState` 加一条（git 面板跟 tab 的 `cwd` 走，无需额外字段）。
- 新组件 `components/GitView.tsx`：变更列表 + stage/unstage/discard/commit（玻璃卡片风；浮层必须 Portal 到 body）。
- diff 渲染：`npm i @codemirror/merge`，扩展 `CodeView` 或新增 `DiffView`，绿增红删，复用现有 CodeMirror 主题。
- `PaneView.tsx` 下拉框加「源代码管理」；`store.ts` `setPaneKind` 支持 `'git'` + 点击变更文件送 diff 的路由。
- 变更侦测：**git 轮询为主**（面板可见时定时 + 手动刷新按钮），fs.watch 防抖为辅。

### 阶段二：回退 UI + hook 通知（覆盖 ④ 第一步）
- git 历史/log 列表 + 回退操作（checkout 文件 / reset soft·mixed·hard / revert）。
- 回退时写 `.easterm/events.json` + 帮用户装 `UserPromptSubmit` hook。先做 PTY 注入 MVP 验证体感，再上 hook。
- 可加 `PreToolUse(Edit|Write)` hook：AI 改文件前校验是否被 GUI 回退过、mtime 是否与其上次 Read 一致，不一致就 block 并要求重读。

### 阶段三：Checkpoint 时间线 + hook 双向集成（差异化护城河）
- 轻量检查点：`PostToolUse(Edit|Write)` hook 让 AI 精准告知改了哪些文件 → Eas-Term 打影子快照（`git stash create` 或影子分支 commit，不污染工作区）+ 刷新 diff；`Stop` hook 打「轮次检查点」。
- GUI 可视化时间线，点任意检查点一键回退，回退自动走通知通道告诉 AI。

## 四、关键约束 / 坑（来自 README 与现状）

- 项目常在**外置卷** `/Volumes/biily`（非 APFS）：`fs.watch` 不可靠 → 变更侦测**以 git 轮询为主**。
- 所有浮层/菜单**必须 React Portal 到 body**：玻璃面板 `backdrop-filter` + `overflow:hidden` 会裁切 `position:fixed` 后代。
- **不引入 nodegit/isomorphic-git 原生模块**：会砸掉现有干净的跨平台构建（node-pty 已是唯一原生依赖）。全部走系统 `git` CLI。
- 大仓库 `git status` 频繁调用要防抖 + 限流；影子快照别污染用户工作区。
- 面板系统是二叉分割树，xterm 实例永不重挂载——新面板类型按现有模式加即可。

## 五、当前进度

- [x] 读完项目、四需求拆解、方案定稿、两决策拍板、方案存档（2026-07-09）
- [x] **阶段一 + 侧栏改版完成，已在运行的 app 里逐项亲眼验证（2026-07-09）**：
  - 后端：`src/main/git.ts`（git IPC：status/diff/stage/unstage/discard/commit/**log**/**describe**；porcelain=v2 -z 解析；describe 走 `callClaude` = `execFile('claude',['-p',prompt])`）、`index.ts` 注册、`types.ts`（GitStatus/GitFileEntry/GitDiffResult/**GitCommit**/**AiResult**）、`preload`（api.git.*）。
  - 前端：`layout.ts`（移除 git PaneKind；code 面板加可选 `diff?: DiffSpec`）、`store.ts`（新增 `openDiff` 把 diff 开进主区域代码面板）、`PaneView.tsx`（下拉框回到 3 项；code 面板有 diff 则渲染 DiffView）、**`SidebarGit.tsx`（新，替代已删的 GitView）**、`Sidebar.tsx`（新增 `WorkspacePanel`：文件/版本 标签）、`FileTree.tsx`（去掉自身头部、改用 refreshKey 属性）、`Icons.tsx`（Sparkle/Clock/Files 图标）、`styles.css`（.workspace/.ws-tab/.git-* 侧栏版）。装了 `@codemirror/merge`。
  - 验证截图：侧栏「文件/版本」标签可切；版本页 = 分支 main + 提交框 + 更改分组(M/D 徽章配色) + 历史(commit信息+相对时间+文件数)；点变更文件 → diff 开在主区域(绿增红删+语法高亮)；点「AI 总结」→ app 内 `claude -p` 返回中文人话("加了 Mac/Windows 打包脚本，能直接双击运行")、原信息灰色保留；typecheck+build 通过。
  - 未亲手点过（代码已完成、同路径）：commit / stage —— 为不动用户真实仓库没在 live 上提交。
  - 已知限制：AI 总结依赖 `claude` 在 PATH。dev 及有 PATH 的终端 OK；**打包后的 app PATH 受限，可能找不到 claude**（阶段二可解析 claude 绝对路径或让用户配置）。
- [x] **分支轨道图 + SourceTree 式历史大视图完成，已亲眼验证（2026-07-09）**：
  - 决策：模仿 SourceTree 精华，**分三期**——期一历史大视图 / 期二逐 hunk 暂存 / 期三分支&推拉操作。
  - 后端：`git:log` 加 `%P`(parents)/`%D`(refs)/`%an`(author) + `--all --topo-order`；新增 `git:commitFiles`(某提交改了哪些文件, diff-tree)、`git:commitDiff`(提交内文件 diff, hash^↔hash)。类型加 GitCommit.parents/refs/author + GitCommitFile。
  - 前端：`gitGraph.ts`（新，**lane 布局算法**：computeGraphRows + parseRefs，侧栏与大图共用；已用 taptv 真实 log 验证 60提交/2轨道/合并识别）、`DiffView` 加 `commit?` 参数走 commitDiff、`layout` 加 PaneKind `history`、`store.openHistory`、`PaneView`（KIND_LABEL 显示 history，下拉框仍只 3 项）、**`HistoryView.tsx`（新，SourceTree 式：上=曲线graph+提交表[描述/作者/日期/ref胶囊]，下=选中提交的文件列表+diff，可拖分隔）**、`SidebarGit` 历史区加轨道 gutter + ref 胶囊 + 「分支图」按钮。
  - 验证：侧栏历史左侧节点+竖轨道+ref标签；点「分支图」→ 主区域大视图（曲线分支/合并可见，Merge 处分叉）；点提交→底部显示 hash/作者/时间 + 改动文件(3) + 点文件看 diff（版本号 1.21.13→1.21.14 绿增红删）；typecheck+build 通过。
- [ ] 期二：当前改动 File Status 做逐 hunk / 逐行暂存（SourceTree 式）
- [ ] 期三：分支切换/新建/合并 + push/pull/fetch（需 GitHub 认证；顺带解决打包后 claude PATH）
- [ ] 回退闭环（原阶段二/三）：回退 UI + 写 .easterm/events.json + Claude Code UserPromptSubmit hook + Checkpoint 时间线
- 备注：用户仓库远程都在 **GitHub**（github.com/biily786063474-boop/*）；本面板驱动本地 git，平台无关。
