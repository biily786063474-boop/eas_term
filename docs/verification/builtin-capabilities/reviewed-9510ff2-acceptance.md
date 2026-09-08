# 0.4.85 正式候选包 9510ff2 验收

源码 `9510ff29e94b143015691715f3e0bfbe16b1caa7`，功能分支已推送，尚未合并 main、打标签或切换线上更新。Bizone 1.21.31 已先发布并在其仓库留痕。旧候选 a17772d/b6f71a6 不作为本次分发产物。

## 真实三端调用

Mac arm64，Claude Code 2.1.263、Codex 0.153.4、omp 18.1.2。六份报告共同 app.asar SHA256：`e74f36a35762efd2b7ba70f83a093c9f26fa747ba42abec28faaf6d0ccd39373`。

| CLI / 入口 | 新建 | 恢复 | 应用重启后恢复 | 证据 |
|---|---|---|---|---|
| Claude AI | 通过 | 通过 | 通过 | [JSON](reviewed-9510ff2-ai-claude/evidence.json) |
| Codex AI | 通过 | 通过 | 通过 | [JSON](reviewed-9510ff2-ai-codex/evidence.json) |
| omp AI | 通过 | 通过 | 通过 | [JSON](reviewed-9510ff2-ai-omp/evidence.json) |
| Claude PTY | 通过 | 通过 | 通过 | [JSON](reviewed-9510ff2-pty-claude/evidence.json) |
| Codex PTY | 通过 | 通过 | 通过 | [JSON](reviewed-9510ff2-pty-codex/evidence.json) |
| omp PTY | 通过 | 通过 | 通过 | [JSON](reviewed-9510ff2-pty-omp/evidence.json) |

18 阶段均有实际原生 CLI 工具调用与成功回执、目标 Frame 唯一 PNG 及 DOM 1×1 解码。另一个 Frame 为活动对象，工具不接收目标 Frame 参数；项目路径含中文空格。未使用模拟 Eas 传输，未覆盖用户审批策略。隔离 profile 与真实用户正在使用的应用互不替换。

全局规则的 write-open 探针被 OS 沙箱拒绝。测试期间 `.claude.json` 哈希发生来源未知的并发变化，原样记录；不能声称所有全局配置完全未变。只提交筛选证据和截图，不提交私有 profile、凭证或原生完整对话日志。

## 迁移与回退

同一 Codex AI 报告证明：真实 workbench 调用成功后删除精确旧托管段；用户正文、CRLF/中文及用户修改段保留；完整备份与前后哈希一致；重启后同一 migrationId、manifestCount=1。明确确认所属应用 exitCode=0 后关闭隔离指引并离线恢复，`offlineRollbackVerified=true`。没有调用产品公开 rollback UI/API，没有迁移真实全局规则。[操作说明](migration-and-rollback.md)。

## 包与自动化检查

- 本机完整套件 2752：2742 通过、10 个 Windows 专用项跳过、0 失败；验证器助手另 6/6。
- build、typecheck、renderer entry、computer helper 和 omp bundle 检查通过。
- Windows [run 34235219068](https://github.com/biily786063474-boop/eas_term/actions/runs/34235219068)：同源构建、正式包启动、设置六项、contracts 7/7、CLI/control 25/25 通过，Windows 测试 0 跳过。包含真实 PE 夹具及打包 Electron Node IPC 取消/断连生命周期，未使用已登录模型账号。[CI 摘要](reviewed-9510ff2-windows-ci/ci-summary.json)、[artifact 与安装包哈希](reviewed-9510ff2-windows-ci/artifact-source-hashes.json)：三个下载 ZIP 均与 GitHub digest 一致并安全解压；EXE SHA256 `eac9790f4491cee13d581bdf73ed559c91b52680420bb86fa80e2cd822706870`。这不构成 Windows Authenticode 或交互安装流程的验证。
- Mac 两架构签名、Gatekeeper Notarized Developer ID、stapler、DMG/ZIP 完整性检查通过。[产物与检查](reviewed-9510ff2-mac-manifest.json)、[源码逐文件对比](reviewed-9510ff2-package-content.json)。本地 `.DS_Store` 被 electron-builder 默认排除，其余包内 out 与 MCP/bundle 逐文件相同；不能把原始文件集合说成完全一致。
- Intel 包在 Apple Silicon / Rosetta 实际运行，[设置六项](reviewed-9510ff2-settings-x64-retry/settings-ui.json)通过并人工查看[截图](reviewed-9510ff2-settings-x64-retry/settings-ui.png)。首轮 15 秒内无调试端口、应用日志为空，失败日志 `/tmp/eas-reviewed-settings-x64.log` 保留；同包无代码/策略修改重跑通过。未查实首次超时根因，不声称 Intel 实机。

## 仍未完成

- 实服务生成响应丢失后的原任务认领与无重复扣费：已取得 Z-Image Turbo 1K 单图 4 墨水报价，等待明确批准；未发起付费生成。协议和模拟测试不能替代实际计费证据。
- Windows 已登录 CLI 实机模型调用条件仍缺；不以 CI 夹具冒充三端真实 Windows 模型验收。
- 外部 Computer Use 指针生命周期仍开放，详见 [发布约束](../releases/computer-use-lifecycle.md)。本次不宣称修复。

Eas-Term 更新清单暂保持 0.4.84。以上剩余事项没有被“构建通过”自动免除。
