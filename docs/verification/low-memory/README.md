# 低内存第一阶段验收（2026-09-26）

源码分支：`fix/low-memory-adaptive-20260926`；基线 `f34bd0b8`。没有合并/发版/安装到用户正式应用。

## 已验证
- 8/16/32GB 模拟 normal/warning/critical 准入矩阵；warning 不再变成 critical，后台预算不变。
- typed RESOURCE_WAIT_TIMEOUT；deadline 先过期后放行；spawn/network timeout 不冒充资源排队。
- 未投递的取消仅一次恢复事件；进入 dispatch 后不再提供“确认未发送”的承诺。
- 恢复按钮只回填，保留既有草稿；真实鼠标点击、暗/亮 UI 截图、真实 history IPC、Frame 卸载重挂验证通过。
- 首问先保存再进入 start IPC，真实 handleSend 在没有任何 assistant 输出时已存下原文；保存失败不会 dispatch。
- 审查两个 Important（新对话残留草稿、排队关闭丢首问）已增加 RED→GREEN 回归并修正。
- 按需聚合 IPC 限频、只输出数字，常规监控不调用新采集器。

## 测量边界
`idle-1790457003921.json` 是本机 **48 GiB**、隔离全新 userData、3 分钟/37 样本。仅 Electron 自有主/渲染/GPU/utility 进程；采样峰值 540.9 MiB，开始 529.0 MiB、结束 525.6 MiB。不是发布前后降幅，也不含外部 CLI/插件。不要把各进程历史峰值和当作同时峰值。

`recovery-result.json` 是事件回放，不是真实 Claude API 会话；测试调用 start 由脚本临时替换，不花模型额度，脚本已还原源码并重建。无生产凭证复制，无全局杀进程。

## 未完成 / 不可声称
- 实体 16GB 同场景基线（当前仅48GB）、真实首次 Claude 发送时延、CLI/插件子进程内存、媒体/3D热点对照。
- Task 5 热点优化与20%目标：必须取得前述基线再选，尚未修改。
- Windows CI、正式打包新用户验收、合并主线及发版未执行。
- 既有 synthetic turn.done 仍可能被完成提醒/用量计数消费；本轮保留旧语义，作为后续兼容问题，不宣称已修复。
- 全量测试带已有 MODULE_TYPELESS_PACKAGE_JSON 警告与19项条件跳过；不把跳过算通过。

复验：`npm run check`；`node scripts/verify-agent-chat-ui.mjs --low-memory`。
测量：先起 `node scripts/verify-app.mjs --port 9446`，再 `node scripts/verify-low-memory.mjs --port 9446 --phase idle --seconds 180`。产物为脱敏聚合 JSON，可直接删除。

最终验证：`npm run check` exit 0，3802项中3783通过、19跳过、0失败；隔离 UI 专项 exit 0；脚本还原后 `npm run build` exit 0。先前一次全量仅因既有首发seq源码格式断言失败，已保持seq语义并修正格式后重跑全量通过。
