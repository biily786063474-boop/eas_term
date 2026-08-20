# 盘点：AI 对话窗口相比终端里的 CLI 缺了什么

## 读这些

- `src/main/agentChat/adapters/`（参数怎么拼的，claude.ts / codex.ts）
- `src/main/agentChat/session.ts`（消息通道、restart、stdin 的写法）
- `src/renderer/src/features/agentChat/`（界面提供了哪些能力）
- 实际跑一下 `claude --help` 和 `codex --help`，对照真实参数面，别凭记忆

## 逐项判

图片输入 / `@` 文件引用 / hooks / 自定义 agents / 权限模式 / 思考强度 /
会话恢复 / 后台任务 / 输出格式 / 中断正在跑的回答（终端里是 ESC）/
粘贴图片 / 多行输入 / 命令历史 / 上下文用量显示。

每项标：**已经有** / **缺** / **有但不完整**（说清哪不完整）。

## 排序

缺的那些按「用户多常碰到 × 补起来多难」排，给出你推荐先补的三条，说明理由。

## 边界

- **只读不改代码。**
- 分不清「缺」还是「我没找到」时，写「没查清」，别当成缺失报上来。
- 结论写 `.plans/cli-gap/findings.md`。
