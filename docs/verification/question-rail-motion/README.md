# 画布导航与 Codex 续发验证

2026-09-07。两项用户反馈已定位并修复。

## 导航不同步

原有监听在 store 通知后排 RAF，早于模块 DOM 提交，且没有观察 style 位置变化。连续平移中实际间距由 12px 变为 22px，最多落后 10px（两帧）。新增锚点及祖先样式/类名监听，在已提交几何变化后、绘制前同步更新 portal。保留抽屉避让、选中显示、分屏与 FLIP 机制。

## Codex 续发被误拦

Codex exec 为一次性进程，stdin=ignore。turn.done 让界面回到可发送，但旧进程仍活着时 planSend 错选 stdin 发送，导致误报上一条仍在处理。现在明确完成后 restart/resume；生成中前后端保持一致，不允许 pending 参数误打断当前任务。旧进程的迟到事件按代次丢弃，当前进程退出后的最后一段 stdout 仍可排空。

## 证据

- 修复前导航逐次测量失败：maxGapError=10px。
- 修复前完成后续发单测失败：actual=send，expected=restart。
- 修复前旧 stdout/stderr/error/exit 回调隔离测试失败。
- 修复后相关状态/进程测试 58 项通过。
- `npm run check`：2,546 通过，1 跳过，0 失败。
- `node scripts/verify-agent-chat-ui.mjs --integration`：23 项通过，连续平移缩放、生成中快捷键保留草稿、结束后立即续发、安装登录、导航、抽屉和分屏均通过；consoleErrors=[]。
- Electron 使用真实 renderer，安装/认证/start/send/模型事件为隔离夹具；不代表真实外网模型回归。测试后自动还原 preload 并重建生产产物。

截图与逐次测量见同目录 integration.json / integration-navigation-module-anchor.png。

软件操作硬性规则：优先使用可用且适合任务的 MCP；只有 MCP 不覆盖、不可用或用户点名时才使用 Computer Use。本轮采用本地工程工具和既有测试脚本，没有使用 Computer Use。

- 本机真实 Codex CLI + 回环模拟 Responses 服务：三轮 resume 通过，三轮均保留第一条消息和原只读沙箱；后两轮包含前文回答。未调用真实账号或外网模型。
- 启动同步异常会复位 alive/busy，返回失败给输入框恢复草稿；失败后无需刷新即可再次投递（实际函数测试覆盖）。
