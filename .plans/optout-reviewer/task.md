# 审查目标：MCP opt-out 持久化逻辑（刚写的，没被独立审过）

## 读这些
- `src/main/mcpOptOut.ts` + `mcpOptOut.test.ts`
- `src/main/mcpBridge.ts`：`setupAgents` / `installMcpConfig` / `removeMcpConfig` / `optOutFile` / `readOptOut` / `writeOptOut`
- `src/renderer/src/features/workspace/FootprintPanel.tsx` 里 mcp 卡片那段
- `src/preload/index.ts` 的 `mcp.installConfig`

## 要判断的四件事
1. **链路完整吗**：「点移除 → 重启不会自动装回来 → 点安装能装回去」。
   重点看失败路径：写标记失败、配置写到一半、`serverPath` 不存在、
   `installMcpConfig` 抛异常时标记已经清了没有。
2. **「任何异常都倒向装」这条不变量真的处处成立吗**（它写在 mcpOptOut.ts 的注释里）。
   有没有哪条路径反过来了。
3. **`removeMcpConfig` 会连 `bizone-canvas` 一起删**（`MANAGED` 有两条）。
   这个设计有没有漏掉的后果？用户重新点安装时两条都回来吗？
4. **单测覆盖到什么、漏了什么。** 现有 6 条都在纯函数层，IO 那半边一条都没有。

## 产出
`.plans/optout-reviewer/findings.md`，按严重程度排序，每条给文件:行号 + 具体失败场景。
**认为某个设计决定是错的就明确写出来**，不要附和。只读不改代码。
