# AI 对话验证记录

2026-09-07，基线 62f993f，分支 codex/agent-chat-codex。

- `npm test`：2453 项，2452 通过、1 跳过、0 失败。包括三个翻译器、模型探测假 stdio server、损坏缓存、资源协议/面板映射、历史及原有组件回归。
- `npm run typecheck`：通过。隔离 UI 脚本的测试构建和恢复源码后的构建均通过。
- `node scripts/verify-agent-chat-ui.mjs --compat`：实际 Electron 组件回放 Codex/Claude/omp 公共事件，目录读取/失败/刷新入口、动态模型项、Markdown、工具成功/失败、HTTP 资源入口均可见；340px 根节点下消息区 331px，scrollWidth 331px；无渲染控制台错误。见 compatibility.json 及截图。
- `node scripts/verify-codex-resume.mjs`：实际 adapter 参数、本机 codex-cli 0.147.0、独立 CODEX_HOME、回环假 Responses 服务。三轮 exit 0、同一 resumeId，请求输入数 3/5/7，后续请求保留首轮消息和回复；检查 transcript 三轮 read-only 策略。不会调用真实账号或推理服务。
- 本机真实 model/list 已读通：返回模型自带推理档位，包括六档模型；前端不硬编码模型名称或最大档位。
- `npm run check` 被未修改的 canvas.css 中 cframe-sweep 动画规则阻止（--sweep infinite 非合成属性）。不能宣称整个 check 通过。

## 验证边界

公共事件回放不等于 Claude/omp 真实远端对话。未向真实插件外部服务发起工具操作；面板映射有测试，实际插件认证、资源失效和握手失败继续走现有宿主处理。三轮探针证明 CLI 恢复和策略传递，没有验证操作系统级写入拒绝，也未覆盖应用端停止后恢复、切换账号以及进程 exit 与发送竞态的全部时序。没有取得 Codex 私有样式，界面改动沿用 Eas-Term 主题和 Markdown 能力。

验证脚本只启动并关闭自己的隔离实例，临时 preload 补丁在 finally 还原；没有替换正式应用、发布或合并分支。

## 首轮模型选择补充

2026-09-07：`--startup` 隔离验证通过。发送前从真实 model/list 读到选项，start 调用数为 0；选择 GPT-5.6-Sol/low 后首轮和模拟 resume 失效重试都传递相同 model/effort。没有发送真实模型请求；start 被可还原测试接口拦截。见 startup-model.png/json。类型检查及构建通过；全量测试 2454 通过、1 跳过、0 失败。
