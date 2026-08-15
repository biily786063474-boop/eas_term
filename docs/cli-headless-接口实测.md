# Claude Code / Codex 非交互模式接口实测

**日期**：2026-08-14　**实测版本**：Claude Code 2.1.232 / Codex（本机 homebrew）
**用途**：通用 CLI 对话前端的技术地基。**这些是真跑出来的，不是读文档抄的。**
样本文件在 spike 靶场（会话结束即失效），关键结论全部誊在这里。

---

## 一、Claude Code

### 起会话

```bash
claude -p "<prompt>" \
  --output-format stream-json --verbose \
  --input-format stream-json \        # 要多轮才加
  --strict-mcp-config \               # 去掉 MCP 噪音：工具从 124 个降到 31 个
  --include-hook-events \             # 审批要靠它才看得见
  --model haiku --effort high \
  < /dev/null                         # 不加会等 stdin 3 秒才继续
```

**`--verbose` 是必须的** —— 不加 stream-json 不完整。

### 多轮会话：一个进程连续对话 ✅

`--input-format stream-json` 下，往 stdin 逐行写：

```json
{"type":"user","message":{"role":"user","content":"记住数字 42"}}
```

每轮以 `{"type":"result",...}` 结束，收到后再写下一行即可。
**实测第二轮能答出第一轮记的数字，会话保持住了** —— 不需要每轮 `--resume` 重开。

### 事件流（实测顺序）

```
system:init              cwd / session_id / tools[] / mcp_servers[] / model /
                         permissionMode / slash_commands[]
system:thinking_tokens   estimated_tokens 累加，可做「思考中」指示（很密集，要节流）
assistant                content: [{type:"thinking"}] / [{type:"text"}] / [{type:"tool_use",name,input,id}]
system:hook_started      hook_event / hook_name          ← PreToolUse 时 = 正在等审批
system:hook_response     output（hook 的 JSON 决定）      ← 审批有结果了
user                     content: [{type:"tool_result", content}]  ← 真实执行结果
rate_limit_event
result:success           is_error / num_turns / total_cost_usd / usage / session_id
```

### 审批：只有 PreToolUse hook 这一条路

- **`--permission-prompt-tool` 这个参数不存在**（2.1.232 的 --help 里没有）
- **`--permission-mode manual` 是「直接拒绝」不是「等审批」**。实测发出
  `{"type":"system","subtype":"permission_denied","tool_name":"Write","tool_use_id":"...","message":"..."}`
  然后 tool_result 是拒绝消息，**没有任何「批准后继续」的通道**。做不了交互审批。
- ✅ **PreToolUse hook 可以**：hook 是外部进程，**能阻塞**。实测 sleep 4 秒后返回
  `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","permissionDecisionReason":"..."}}`
  → 文件**真的被创建**。`permissionDecision` 取 `allow` / `deny` / `ask`。

hook 从 stdin 收到的 payload 含：`session_id`、`transcript_path`、`cwd`、`tool_name`、`tool_input`
—— 审批卡片要显示的信息全都够。

hook 配置写在**项目级** `.claude/settings.json`（不必动用户全局）：

```json
{ "hooks": { "PreToolUse": [
  { "matcher": "Write", "hooks": [{ "type": "command", "command": "<脚本绝对路径>" }] }
]}}
```


### hook payload 的完整结构（2026-08-14 实测抓取）

```
session_id, transcript_path, cwd, prompt_id, permission_mode,
hook_event_name, tool_name, tool_input, tool_use_id
```

**关键：hook 路有 `tool_use_id`，而流里的 `hook_started`/`hook_response` 只有 `hook_id`。
两路没有共同的关联键**，所以审批不能靠"两路缝合"实现 —— 必须由 hook 路单独驱动，
流里的 hook 事件只当噪音丢弃。（写设计时曾假设可以按 tool_use_id 缝合，实测证伪。）

### hook 能阻塞多久（2026-08-14 实测）

不设 `timeout` 字段时，**hook 睡满 70 秒未被切断**，正常返回决定、工具照常执行（总耗时 86s）。
所以「PreToolUse hook 有 60 秒默认上限」这个说法在 2.1.232 上**不成立**——
做审批卡片时用户有充足时间思考。已验证到 70 秒，更长未验。

### ⚠️ 三个坑（都实测踩过）

1. **工具被拒后模型会撒谎说「已创建完成」**。实测 `manual` 模式下 Write 被拒，
   模型最后一句是「已创建完成。」而文件根本不存在。
   **UI 必须以事件为准渲染执行结果，绝不能拿模型的文字当事实。**
2. **`--bare` 会跳过认证** —— 输出 `Not logged in · Please run /login`，
   `result.is_error=true`。想减噪音要用 `--strict-mcp-config`，不是 `--bare`。
3. **用户机器上的 SessionStart hooks 会刷屏**（实测 5 个，产生 10 条 hook 事件）。
   前端要按 `hook_event` 过滤，只认 `PreToolUse`。

### 那四个功能 CLI 原生都有

`system:init` 的 `slash_commands` 里实测含 **`compact` / `context` / `model` / `effort`**。
所以「一键压缩」「上下文显示」「模型切换」「effort」都能通过发 slash command 触发；
起会话时也可以直接用 `--model` / `--effort` 参数。

用量与花费从 `result` 事件读：`usage.input_tokens` / `output_tokens` /
`cache_read_input_tokens` + `total_cost_usd`。

---

## 二、Codex

### 简单路径：`codex exec --json`

```bash
codex exec --json --sandbox workspace-write "<prompt>" < /dev/null
```

事件流干净：

```
{"type":"thread.started","thread_id":"..."}          ← 会话 id，resume 用
{"type":"turn.started"}
{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"..."}}
{"type":"turn.completed","usage":{"input_tokens":22261,"cached_input_tokens":15104,
                                   "output_tokens":346,"reasoning_output_tokens":246}}
```

**坑**：① 默认 `read-only` 沙箱，不给 `--sandbox` 写文件会被拒
（stderr: `patch rejected: writing is blocked by read-only sandbox`）；
② 不给 `< /dev/null` 会卡在 `Reading additional input from stdin...`。

**`exec` 没有逐次交互审批** —— 只有 `-s/--sandbox` 三档
（`read-only` / `workspace-write` / `danger-full-access`）加一个 `--approve-for-me`。

### 正确路径：`codex app-server`（有原生审批）

```bash
codex app-server generate-json-schema --out <DIR>   # 39 个 schema 文件
codex app-server generate-ts                        # 直接生成 TypeScript 绑定
```

协议里**原生带审批请求/响应**：

| Schema | 关键字段 |
|---|---|
| `CommandExecutionRequestApprovalParams` | `approvalId` `command` `commandActions` `cwd` `reason` `threadId` `turnId` `startedAtMs` `networkApprovalContext` `proposedExecpolicyAmendment` |
| `CommandExecutionRequestApprovalResponse` | `decision`（`CommandExecutionApprovalDecision`）|
| `ApplyPatchApprovalParams` | `callId` `conversationId` `fileChanges` `grantRoot` `reason` |
| `ApplyPatchApprovalResponse` | `decision` |

还有 `ClientRequest` / `ClientNotification` / `ServerNotification` 等。
标着 experimental，但它是唯一能做 Codex 审批卡片的接口，且能生成 TS 绑定——
对 Electron + TypeScript 的本项目是最省事的一条。

---

## 三、对前端设计的硬约束

1. **两边审批机制完全不同**，但都能做到「弹卡片等用户点」：
   Claude 走 PreToolUse hook（外部进程阻塞），Codex 走 app-server 的 approval 请求。
   中间事件模型必须把这两种都抽象成同一个「待审批」事件。
2. **执行结果只信事件，不信模型文字**（见坑 1）。
3. Claude 的 `thinking_tokens` 事件极密集，前端要节流，别每条都触发渲染。
4. Eas-Term 已有 MCP bridge 在 `127.0.0.1` 上监听（见 `src/main/mcpBridge.ts`），
   Claude 的 hook 脚本可以直接 POST 给它问审批结果，**不用新造通道**。
