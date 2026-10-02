<claude-mem-context>
# Memory Context

# $CMEM terminal 2026-08-24 8:48pm PDT

No previous sessions found.
</claude-mem-context>

<!-- eas-term:arch:begin —— 手写区，claude-mem 只托管上面那个 context 块 -->
# Eas-Term — 给 AI 的工程约定

> 与 `CLAUDE.md` 同源，这份供只读 `AGENTS.md` 的 CLI（Codex 等）使用。

## 动手改代码前先读架构图纸

`docs/architecture/` 是本仓库的 AI 导航图纸。**改代码前必读两份索引**（合计约 1.2 万 token）：

- `docs/architecture/10-模块领地图.md` — 全局领地图、耦合警报、加东西要改哪几个文件，末尾是专题记录索引
- `docs/architecture/03-agent角色边界.md` — 3B 开发期红线（改了会**静默失效**、会把**历史修复改回去**），末尾是补充护栏索引

再按需读：领地明细 `10a`（渲染层）/ `10b`（主进程）/ `10c`（外围）；要改的文件出现在专题记录索引里 → 读 `10d`；
出现在补充护栏索引里 → **必须**读 `03b` 对应条目；改角色 / 协同板 / 团队编排 → 读 `03a`。
改完就地更新对应分册，**不要在 10 / 03 两份索引首尾追加带日期的段落**（`npm run check` 有体积上限）。

其余：`01-系统上下文`（外部依赖边界，不得私自新增出站）· `02-分层架构`（含启动顺序硬依赖）·
`11-MCP工具网络` · `12-skill与hook流程` · `13-所有权矩阵`（含**跨文件同步清单**）。

## 三条最容易踩的

1. **写文件的 IPC 必须过 `guardPath`/`guardDir`** — `fsGuard.ts` 是全项目唯一的写路径白名单。
2. **`src/main/index.ts` 的 `whenReady()` 注册顺序不可调** — 打乱是静默失效，不报错。
3. **有一批"看起来像漏了、其实是刻意为之"的代码** — 如 `CanvasStage` 故意不订阅 `canvas.shapes`、
   撤销栈不在 action 里写 `record()`。动它们前先读 03 号图纸的"历史修复区"。

## 改了代码要顺手更新对应图纸，同一个 commit 提交。

## 🌐 新功能中英文同步做（用户长期规则，2026-10-01）

**中文做完、英文没做 = 没做完。** 新功能、改文案、改界面，中英两种语言在**同一个分支、同一批提交**里一起完成，不留「英文以后补」。
具体落到：

- **界面文字**：一律走 `t('区域.键')`，同一个提交里同时加 `<区域>.zh.ts` 与 `<区域>.en.ts`（英文缺键 typecheck 直接失败）；**新建的界面文件当场加进 `src/shared/i18n/migrated.json`**，之后再写死中文 `check-i18n` 会拦。
- **用户看得到的其他文案**：主进程报到界面上的错误、对话框、插件清单与面板、菜单、通知、灵动岛 —— 同样走词典。
- **发给 AI 的提示词 / guidance / MCP 描述 / 插入输入框发给 AI 的原文**：照旧保持中文，行尾 `// i18n-allow: 原因`（规矩见 `docs/i18n/README.md`「不翻的」）。
- **官网与更新日志**：改 `site/` 的页面同时改 `site/en/` 对应页；写 `CHANGELOG.md` 的同时写 `CHANGELOG.en.md` 同版本条目。
- **验收两种语言都看**：UI 改动在中文和英文界面各验一遍（验收实例在 prefs 里写 `"lang":"en"`），截图两份；英文下不能有残留中文、不能溢出截断。
- 术语按 `docs/i18n/glossary.md`；机制细节见 `docs/i18n/README.md`。

## 发版源码基线

发主程序版本前必须读 `.agents/skills/release/SKILL.md`。默认只从 fetch 后的最新 `origin/main` 干净工作树构建，发布前再核对主线是否前进；只有用户明确指定分支/提交时才例外。不得因当前 agent 所在分支不同而漏掉已合入主线的功能。
<!-- eas-term:arch:end -->

## Computer Use 发布约束

指针残留已确认与外部 Codex Computer Use 服务有关；本机退出服务只算临时恢复。后续涉及 Computer Use 接入或发版前，必须阅读 `docs/verification/releases/computer-use-lifecycle.md`。清理由软件按所属会话自动执行，不依赖 agent 自觉收尾；禁止在任务结束时全局杀服务。相关生命周期验收未完成，不得标记为已修复。

## 软件操作工具优先级（用户硬性规则）

提到的软件若有可用且适合当前任务的 MCP，必须优先使用 MCP；先检查已安装/可发现的工具能力。仅当 MCP 不覆盖所需操作、不可用，或用户明确要求 Computer Use 时，才使用 Computer Use，避免不必要的 token 消耗。

## 插件接入方法论（用户硬性要求，2026-09-21）

接入、补功能或验收任一插件前，必须先读 `docs/knowledge/plugin-integration-baseline.md`。
以已跑通的同类样板为基准，复用统一宿主/授权配置/UI/三 CLI/打包/热更新/验收流程；
仅验证业务与平台差异。先查历史结论和失败证据，禁止不查就从零重复试错。
新方案必须说明现有基准为何不适用；新结论及时回写基准。复用方法不继承未经验证的完成声明。
