# 0.4.85 候选 a17772d 正式包验收

本记录对应源码 `a17772d8c2dc211a6fc02ef586f787ce21f6a321`，**尚未发布**。Windows npm CLI 启动兼容性审查发现阻断，修复后的包必须重新冻结。目录中的 `final-*` 是当时冻结候选的测试名称，不表示当前版本可以发布。

## 实际 CLI 调用

Mac arm64 正式签名、公证包，app.asar SHA256：
`fe1e9dc93d210e33e4c5e6af8d950250703431c47a6537f4b26a8001b488466b`。

| CLI / 入口 | 新建 | 恢复同一原生会话 | 应用重启后恢复 | 证据 |
|---|---|---|---|---|
| Claude AI 对话 | 通过 | 通过 | 通过 | [JSON](final-ai-claude/evidence.json) |
| Codex AI 对话 | 通过 | 通过 | 通过 | [JSON](final-ai-codex/evidence.json) |
| omp AI 对话 | 通过 | 通过 | 通过 | [JSON](final-ai-omp/evidence.json) |
| Claude PTY | 通过 | 通过 | 通过 | [JSON](final-pty-claude-retry/evidence.json) |
| Codex PTY | 通过 | 通过 | 通过 | [JSON](final-pty-codex-retry/evidence.json) |
| omp PTY | 通过 | 通过 | 通过 | [JSON](final-pty-omp/evidence.json) |

18 阶段均有原生工具调用/结果对应、当前项目内 PNG 到目标 Frame、实际 DOM 图片解码的证据。测试把另一个 Frame 设为活动对象，未向工具传目标 Frame。项目路径包含中文和空格。没有以模型自述或 mock 传输替代实际调用，没有覆盖 CLI 审批设置。

测试仅写隔离 profile 和项目；真实全局规则文件由同一 OS 沙箱实测拒绝写打开。`.claude.json` 前后哈希出现并发变化，写入者归属未知；不声称所有全局文件未变。私有 profile/CLI 原始对话日志含登录或会话信息，未提交；只提交筛选后的测试调用证据。

## 保留的失败与重试

- [Claude PTY 首次失败](final-pty-claude/evidence.json)：原生输出已完成 init，宿主状态 workbench 38 工具、Bizone 52 工具 ready；随后出现 `system/api_retry`，attempt=1、max_retries=1、error=unknown。测试期限内没有 CLI 退出/完整工具回执。不能确定模型请求重试的底层网络原因。同一脚本、同一包、同一权限策略重跑三阶段通过；没有产品修改或审批绕过。
- Codex PTY 首轮只留下 `new.png`，没有最终 evidence.json，运行进程已经不存在，原因未确定。该轮不计通过；重新完整运行的 `final-pty-codex-retry` 三阶段才计入矩阵。
- Intel Mac 首次设置检查 15 秒内未获得调试端口，应用日志为空；另行执行包内 Node 模式确认 arch=x64、Node=22.21.1，第二轮同一包六项设置检查通过。Rosetta 首次启动耗时是可能原因，未作为已证根因。
- 之前无限并发全套测试有一次启动等待超时；单项复核及并发 4 的完整套件通过。最新冻结源码测试总计 2722/2722，0 跳过。验证脚本证据解析测试另为 4/4。

## 安装文件与平台检查

[安装文件哈希](frozen-package-manifest.json)、[包内容逐文件比较](frozen-package-content.json)。两种 Mac 架构分别比较 139 个 out 文件、18 个 MCP/内置 bundle 资源，均无差异。

两种架构分别通过 `codesign --verify --deep --strict`、`spctl --assess --type execute --verbose`（Notarized Developer ID）、`xcrun stapler validate`。两个 DMG 的 `hdiutil verify` 和两个 ZIP 的 `unzip -tq` 均通过。

Intel Mac 设置实际点击/IPC/持久偏好六项检查：[JSON](final-settings-x64-retry/settings-ui.json)、[截图](final-settings-x64-retry/settings-ui.png)。这是 Apple Silicon 主机上的 x64/Rosetta 执行，不声称 Intel 实机验证。

Windows workflow [34216597763](https://github.com/biily786063474-boop/eas_term/actions/runs/34216597763) 构建、实际包启动、设置六项检查成功：[证据](frozen-windows-ci/source.json)、[设置](frozen-windows-ci/settings-ui.json)、[截图](frozen-windows-ci/settings-ui.png)。下载 artifact ZIP 的 SHA256 与 GitHub artifact 摘要一致，安全解压后另算 EXE 哈希。该 CI 无 CLI 登录账号，不是三端真实模型验收。

## 当前发布阻断

- Windows 官方 npm `.cmd` 路径被 PTY 拒绝，AI 启动/检测也不一致；修复任务见 [计划](../../superpowers/plans/2026-09-08-windows-cli-launch.md)。原生自动更新默认关闭，不能当成兜底。
- 实服务付费断线防重只取得单图 4 墨水报价，尚未得到确认，未生成/扣费。协议/模拟服务验证不能证明实际扣费次数。
- Windows 已登录 CLI 实际调用证据仍缺；不以 CI 设置检查冒充。
- 外部 Computer Use 指针生命周期继续开放，不属于本次已修复事项。

## 正式包迁移演练

[实际证据](frozen-migration-codex/evidence.json)：同包 Codex 三次真实工具调用，首次后精确旧托管段删除；用户区字节、用户修改过的另一托管区保持；备份/清单哈希一致；重启后仅一份迁移 manifest。应用退出后关闭隔离 profile 指引，按文档检查哈希并离线恢复原文件。此项验证的是正式包迁移入口与离线维护程序，不是产品公开 rollback UI/API。
