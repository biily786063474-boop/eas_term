# Codex 原生目标生命周期验收 · 2026-09-18

## 根因证据
- 受影响版本 Codex CLI 0.153.4。原始 rollout 中首轮 task_complete 后原生 goal 已发起后续轮次，随后几十毫秒内 interrupted；不是 UI 把 commentary 错标为最终回复。
- 官方同版本源码：exec JSONL processor 在 TurnCompleted 返回 InitiateShutdown，exec 主循环 unsubscribe 并 shutdown；按首轮 task_id 过滤还会丢弃续轮事件。
- 来源：https://github.com/openai/codex/blob/rust-v0.153.4/codex-rs/exec/src/event_processor_with_jsonl_output.rs （506–529）；https://github.com/openai/codex/blob/rust-v0.153.4/codex-rs/exec/src/lib.rs （1113–1138、1427–1466）。时间证据见 ../../diagnostics/2026-09-18-codex-goal-abort-evidence.json。

## 修复范围
只切换托管 AI 对话 Codex launcher 内部的原生传输为 app-server，保留现有外部 JSONL 消费端。goal active 保持任务 busy，不在首轮关闭服务；原生目标非 active 且无活动轮次才结束。无额外模型轮询、不自动创建目标、不自动替用户发送继续。CLI 没有原生目标且自己主动结束时，本修复不会擅自续跑。

## 已验证
- npm run check：3279 通过、19 跳过、0 失败（共3298）。类型检查、hook、样式及动画静态检查包含在内。
- npm run build 通过。
- 定向桥接、launcher参数、翻译和进程接力测试通过；桥接13项含拒绝补丁的 translator 联测。
- 真实 CLI + localhost Responses fixture：只提交一次 turn/start，原生自行执行两轮，最终只输出一次宿主 turn.completed，见 native-result.json。
- 构建后的真实 Electron → IPC → managed launcher →真实 CLI：两轮之间 busy 保持、第二条回复可见、预算到达结束、普通 resume 问答正常结束、停止不再自动重启。见 ui-result.json 和两张实机截图。
- 独立只读审查：初次发现 fileChange declined/kind 映射错误，已以回归测试修正；最终复核未发现阻断问题。

## 失败记录与限制
- 初次全量测试一项已有 launcher IPC config 夹具在5秒内没启动，原始记录 initial-check-failure.txt；未放宽超时，专项6/6和最终全量复跑通过。
- 初次 UI 验收脚本遇 Runtime.evaluate timeout；测试应用未正确退出导致残留占用。只清理本次 scratch profile 对应进程，测试清理改为退出自有应用。后续复跑仍遇启动阶段 CDP 超时；改为等待正确 file 页面与标题、启用 Runtime 后最终复跑通过（不延长超时）。另修正测试脚本的持久化画布格式及 materialize 后的 leaf 会话绑定。未修改生产 UI 或绕过沙箱。
- 真实在线模型与账号端到端、Windows 实机、旧 Codex 版本未验证。协议不兼容会报错，不静默退回有缺陷的 exec。
- 这证明生命周期通路，不保证模型自身必然完成任意长任务。
- 独立分支 fix/codex-goal-lifecycle-20260918，基于88ae4a8。用户已授权审查并本地合入 main；未推送、未发布、未替换正式应用，不夹带原工作区其他 agent 的修改。
