# 正式包 PTY 验证器

入口：`scripts/verify-builtin-pty-package.mjs`。与 AI 对话验证器分开，不调用 `agentChat.start`，不安装模拟 transport。

示例（只在待验正式包就绪后执行）：

```sh
node scripts/verify-builtin-pty-package.mjs --executable '/absolute/Eas-Term.app/Contents/MacOS/Eas-Term' --cli omp --omp-source-profile '/absolute/existing/Eas-Term-userData' --allow-real-model-calls --restart
```

三个 CLI 分别使用原生支持的非交互 JSON 模式：Claude `-p --verbose --output-format stream-json`、Codex `exec --json`、OMP `--print --mode json`。恢复使用各自明确的原生 resume ID，不使用“最近一次”，也不覆写 approval/yolo/bypass 设置。

测试先通过真实 preload 创建自己拥有的 PTY，再把此 ptyId 绑定到 target Frame 的 terminal leaf；另一 Frame 排在前面且活动。经自己 PTY 的真实 shell 执行 `command claude/codex/omp`，记录 `command -v` 结果，必须命中 `capability-pty-bin`。不自行设置 OMP 配置根，不绕过应用的 PATH launcher。

每一轮要求原生结构化工具调用及同 ID 成功结果包含本轮 PNG 和 target Frame，再检查真实 renderer state 的唯一图片节点，并等待该节点实际 `<img>` 解码。仅模型说 DONE 不通过。`--restart` 关闭自己启动的应用，再用同一隔离 profile 新建 PTY，以相同原生 resume ID 验证重连。

隔离 profile 中的 stdout/stderr/session 可能包含私有数据，保留以供本机诊断，不放入证据目录。证据只提取精确测试文件的工具身份、结果、图片状态、截图和配置写保护 hash。macOS sandbox 先验证真实全局规则文件写禁止；其它进程造成的文件 hash 漂移独立记录，不宣称全局未变。Windows 当前需要独立 OS 用户验证器，本脚本会明确拒绝运行。

2026-09-08：仅完成语法检查、`--help` 和 3 项纯解析/安全 shell 引号测试；没有据此启动旧包或调用模型。实现期间发现 OMP PTY 缺应用管理配置根的产品问题，已交独立工程修复；验证器不会注入测试环境变量掩盖它。实际三端正式包验收仍待执行。

## adhoc 预验结果（非最终签名包验收）

`pty-preflight-claude-cleanup` 和 `pty-preflight-omp-cleanup` 均完成新建、恢复、应用重启后恢复三阶段；每轮原生 CLI exit=0，1 条精确 `canvas_open_image` MCP 回执，图片唯一落在 target Frame，真实 `<img>` 已解码 1×1 测试 PNG。两者测试的 `app.asar` SHA-256 均为 `fe1e9dc93d210e33e4c5e6af8d950250703431c47a6537f4b26a8001b488466b`。最终公开签名包仍必须重新运行，不能用此 adhoc 结果代替。

初次 Claude 测试在恢复旧 terminal leaf 后直接创建新 PTY，随后旧组件清理干扰了新 PTY，造成下一阶段命令根本未运行。验证器改为先卸载旧 leaf 并等待 React cleanup，再创建自己新的 PTY，并记录 shell 输出字节/退出状态；没有因此修改产品。

OMP 首次模型把已有 `node_repl` 桥误认为全部能力。补充“允许按原生文档发现工具，也可通过已有桥发现，但不能虚构 API”的任务提示后，模型找到直接暴露的 `mcp__eas_capabilities_eas_term_canvas_open_image`。成功重跑未改变 approval、插件启用或 OMP 配置根。原失败证据保留。

两份成功报告仍保留运行期间全局文件 hash 漂移，写入者归属未知；同一 OS sandbox 的受保护文件 write-open 均被拒绝，因此独立报告此并发观察，不声称全局文件完全未变。
