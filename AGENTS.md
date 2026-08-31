<claude-mem-context>
# Memory Context

# $CMEM terminal 2026-08-24 8:48pm PDT

No previous sessions found.
</claude-mem-context>

<!-- eas-term:arch:begin —— 手写区，claude-mem 只托管上面那个 context 块 -->
# Eas-Term — 给 AI 的工程约定

> 与 `CLAUDE.md` 同源，这份供只读 `AGENTS.md` 的 CLI（Codex 等）使用。

## 动手改代码前先读架构图纸

`docs/architecture/` 是本仓库的 AI 导航图纸。**改代码前至少读这两份**：

- `docs/architecture/10-模块领地图.md` — 我在哪块地、哪里是禁区、加东西要改哪几个文件
- `docs/architecture/03-agent角色边界.md` — 3B 节列出改了会**静默失效**、会把**历史修复改回去**的位置

其余：`01-系统上下文`（外部依赖边界，不得私自新增出站）· `02-分层架构`（含启动顺序硬依赖）·
`11-MCP工具网络` · `12-skill与hook流程` · `13-所有权矩阵`（含**跨文件同步清单**）。

## 三条最容易踩的

1. **写文件的 IPC 必须过 `guardPath`/`guardDir`** — `fsGuard.ts` 是全项目唯一的写路径白名单。
2. **`src/main/index.ts` 的 `whenReady()` 注册顺序不可调** — 打乱是静默失效，不报错。
3. **有一批"看起来像漏了、其实是刻意为之"的代码** — 如 `CanvasStage` 故意不订阅 `canvas.shapes`、
   撤销栈不在 action 里写 `record()`。动它们前先读 03 号图纸的"历史修复区"。

## 改了代码要顺手更新对应图纸，同一个 commit 提交。
<!-- eas-term:arch:end -->
