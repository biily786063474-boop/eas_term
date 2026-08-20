# progress — optout-reviewer

## 已做
1. 读 task.md
2. 读 `src/main/mcpOptOut.ts`(45行) + `mcpOptOut.test.ts`(38行) —— 纯函数层
3. 读 `src/main/mcpBridge.ts` 关键段：124-200(serverScriptPath/skipGlobalWrite/bizoneServerPath)、
   200-262(mcpEntries/bizoneRunner)、260-380(writeClaudeConfig/purgeLegacyDshMcp/writeCodexSection)、
   380-600(removeMcpConfig/optOutFile/readOptOut/writeOptOut/setupAgents/installMcpConfig)、704-716(listen→setupAgents)

## 下一步
- FootprintPanel.tsx 的 mcp 卡片：看 UI 用哪个信号判断「装/未装」
- preload 的 mcp.installConfig
- package.json：dev 与打包版 userData 是否同一目录（决定 dev 实例点移除的破坏范围）
- 试跑单测

## 卡住
（无）
