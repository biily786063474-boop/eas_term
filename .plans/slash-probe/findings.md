# 实测：headless 下哪些 slash 命令真能用

派出去的那批 agent 没等到确认（清单挂了 9 分钟），这份是主 agent 自己起子进程测的。
方法：`( printf '<stream-json 一行>'; sleep 11 ) | claude -p --input-format stream-json
--output-format stream-json --verbose`，一条命令一个进程，取 assistant 的 text 与 tool_use。

> **踩坑记一笔**：第一版脚本套了 `timeout`，macOS 上根本没有这个命令，
> 整条管道静默无输出 —— 差点被当成「所有 slash 都不可用」。

## 结论表

| 命令 | 能不能用 | 它回了什么 |
|---|---|---|
| `/cost` | **可用** | 订阅用量：`Current session: 1% used · resets ...` |
| `/usage` | **可用** | 同 `/cost` |
| `/context` | **可用** | 上下文用量表：`**Model:** claude-opus-5 **Tokens:** 38.3k / 1m (4%)` + 分类明细 |
| `/mcp` | **可用** | `6 MCP server(s): 3 connected, 2 connecting, 1 not connected, 0 disabled.` |
| `/agents` | 半可用 | `The /agents wizard has been removed.` —— 命令认得，但功能被上游删了，改让你直接说 |
| `/clear` | 可用但无输出 | 一个字都不回。**不能靠「有没有回应」判断它执行没有** |
| `/compact` `/model` `/effort` | **可用** | 软件自己在用（回执被 slashSilence 有意吞掉，别被它迷惑） |
| **自定义 skill**（如 `/resume-status`）| **完全可用** | 真的执行了 —— 实测调了 8 次 Bash 并产出完整报告 |
| `/help` | 不可用 | `/help isn't available in this environment.` |
| `/status` | 不可用 | 同上句式 |
| `/memory` | 不可用 | 同上句式 |
| `/rewind` | 不可用 | 同上句式 |
| 不存在的命令 | — | `Unknown command: /zzz-nope` |

## 两条推翻了先前判断的事实

1. **「打错命令完全静默」不成立。** app 里确实会显示 `Unknown command: xxx` ——
   先前那次没看到，是因为观察时按用户消息的位置往后截 260 字符，
   而回答在 DOM 里被一堆 UI 元素隔开了。**不是 bug，不用修。**
2. **`slashSilence` 不吞用户手输的命令。** 它只在软件自己发 `/model` / `/effort` 时开静默期
   （`session.ts` 里唯一的触发点在切模型那段）。

## 对功能的影响

真正缺的只有一件：**输入框没有候选列表**。终端里 CLI 自己有 TUI 补全，
AI 对话窗口的输入框是我们自己的，打 `/` 什么都不会出现。

候选该收哪些（按上面的实测）：

- 确认可用的内置命令：`/cost` `/context` `/usage` `/mcp` `/clear` `/compact` `/model` `/effort`
- **用户自己的 skills** —— 这条价值最高，用户装了几十个，而且实测完全可用
- 明确不可用的（`/help` `/status` `/memory` `/rewind`）**不要放进候选**，
  列一个点了只会回「isn't available」的东西，比不列更糟

## 边界

- 只测了 Claude，没测 Codex。
- 没测 `/init` `/review` `/doctor` `/resume` `/config` —— 它们要么有副作用、
  要么会开长任务，为省 token 跳过了。**没测出来的不要当成不可用。**
