# 内置能力迁移与回退（实现进行中）

本分支尚未发版，下面明确区分已落地的保护与正式包验证范围。不能把本文件作为正式包验收通过证明。

## 已落地

- 随包唯一指引源是 `resources/plugins/eas-capabilities/guidance/`；受管会话追加短指引，详细文档按需读取。
- 启动不再自动替换全局 MCP 表或全局规则。旧全局文件暂保留；设置页只读显示“旧版配置 / 待迁移”。
- 首次创建 `userData/capability-preferences.json` 时继承旧 MCP opt-out；之后以用户在新模块开关中的选择为准，旧标记不能阻止重新启用。损坏或未知版本配置默认全部禁用，不覆盖原文件。
- 会话快照、PTY 入口和 omp 显式插件目录均写入 app-owned userData，名称随内容/路径变化，不能串用旧快照。租约不写进快照/原生配置。
- Codex 在自有启动进程中调用同版本原生 `config/read`，在内存保留用户指引、工具禁用与技能禁用。失败不启动该轮模型，不回写用户配置。

## 安全迁移工具与主进程入口

`capabilityMigration.ts` 仅接受主进程提供的规范绝对路径及精确托管段/哈希证据。新链路不健康时返回 deferred；围栏缺失、重复、归属不明或非 UTF-8 时不修改。

修改前将完整原文件与校验清单写入 0600 备份，fsync 后再次检查目标原文，再原子替换，保持文件模式。用户正文按字节保留。普通用户目录中的相同 server 名、相同标题或路径前缀都不单独构成所有权证据。

回退工具按 migrationId 校验备份和当前文件。当前内容不是本次迁移结果时拒绝覆盖，避免抹掉用户迁移后的编辑。Windows 已测文件原子替换结构；不宣称目录 fsync 支持断电持久性。

`CapabilityMigrationService` 提供主进程运行入口 `onSuccessfulWorkbenchCall(projectPath?)`：调用方必须在真实受管 workbench 工具成功后调用，并通过 `isEnabled` 检查禁用策略。仅扫描固定 `home/.codex/AGENTS.md` 和主进程确认可信的项目根 `AGENTS.md` / `CLAUDE.md`，仅删除与 `expectedCodexRegion()` 完全相同的段。归属不明、用户改过的段和禁用状态均保留。构造时注入的路径、信任及内容生成器不向 renderer 或 MCP 开放。

完整备份、校验清单、迁移前意图和迁移后结果写入 `userData/capability-migrations/`，文件权限 0600。可信主进程回退使用 `service.rollback(migrationId)`，不接受目标路径；从清单反查路径后再次验证固定文件名及项目信任，再检查备份与当前哈希。回退意图也会持久保存，并阻止后续工具调用自动再次删除同一文件的规则。磁盘或审计失败须由调用方捕获，不能将已经成功的业务工具调用改判失败。

第三方 MCP 与仅凭同名无法确认归属的旧 MCP 注册不自动迁移。当前入口的临时目录测试不等于真实用户升级验收，发布前仍须核对成功调用接线和正式包演练。

## 发布前仍须完成

1. 对与当前 `expectedCodexRegion()` 不同的旧版本段保持原文，进一步迁移需另补可靠归属证据。
2. 真实成功工具调用已接 service，并经独立审查；正式包仍需验证迁移结果，保持第三方配置与禁用选择，不以仅握手代替业务调用成功。
3. 正式包升级、重复启动、回退演练，验证用户正文/第三方 MCP/角色限制没有变化。
4. 记录安装包版本、哈希、实际 CLI 调用和恢复证据；当前开发测试不能替代。

尚未对用户全局文件执行本次自动迁移，因此现在没有可供用户执行的 migrationId，也不应手动批量删除旧配置。

## 软件回退操作顺序

1. 在设置中关闭使用指引模块，结束本软件会话并退出应用；先保存当前用户规则与 app-owned 数据目录。
2. 检查 `capability-migrations/<migrationId>.json` 的 `targetPath`、`beforeHash`、`afterHash`，以及同名 `.bak` 完整备份。没有记录就没有本次迁移要恢复，不要猜路径或清空全局 MCP 配置。
3. 工程维护入口 `rollbackBuiltinCapabilityMigration(migrationId)` 按可信清单回退，同时写入 hold 和审计事件。它目前是主进程维护 API，**没有对用户公开的一键回退按钮或 MCP 命令**。
4. 如由维护人员离线恢复，必须先确认 `.bak` SHA256 等于 `beforeHash`、目标当前 SHA256 等于 `afterHash`，再以备份原文件恢复并保留原权限。哈希不符时只做人工合并，不覆盖用户后续编辑。保持指引模块关闭，避免再次触发迁移。
5. 使用保留的 0.4.84 正式包回退软件。0.4.84 仍会使用其旧规则分发流程；备份与新模块偏好应保留，以便再次升级。第三方插件、凭证库、角色配置和用户正文不随回退删除。

Mac 默认数据目录为 `~/Library/Application Support/Eas-Term`；Windows 默认目录为 `%APPDATA%/Eas-Term`。自定义 userData 的安装以实际启动目录为准，不能照抄默认路径。

## a17772d 正式候选包迁移演练

[frozen-migration-codex/evidence.json](frozen-migration-codex/evidence.json)：Mac arm64 签名公证包，经真实 Codex 工具成功调用触发迁移。仅在隔离项目中写入从已有旧托管段复制的测试规则；真实全局规则受 OS 写保护。

- 首次调用后精确托管段删除，前后用户正文（含 CRLF/中文）逐字节保留。
- 另一份用户修改过标题的托管段保持不变，审计为 ownership-unproven。
- 完整原文件备份、beforeHash/afterHash 与实际字节一致，存在迁移前意图和成功结果事件。
- 同一会话恢复和应用重启后再次调用保持结果，目标只有一个迁移 manifest。
- 应用退出后，验证器先关闭隔离 profile 的指引，再按本文离线维护流程校验备份/当前哈希并恢复原文件；未调用主进程 rollback API，也没有对外回退 UI。

此证据对应 a17772d；Windows CLI 修复后的最终分发包仍需确认相同链路。没有迁移真实用户全局文件，未把隔离演练说成已替用户执行迁移。
