# cross-checker · 过程记录（第二轮，0.4.32）

批次目标：验证确认清单能停住等人点 —— 这一批点「算了」。
我的角色：cross-checker，与另一角色并列，用来检验清单能否列出多行。

> 上一轮（0.4.30 / 提交 `fa22f60` 那会儿）我这个目录里已经有一份产出。
> 本文件是**第二轮**，编号接着上一轮走（上轮 F-1…F-4，本轮从 G-1 起），
> 上一轮的原文在 git 里：`git show 91e44af:.plans/cross-checker/progress.md`。

## 我是怎么定位自己的处境的

1. `git log` → 上一轮之后有三个提交，其中 `91e44af fix(team): team_spawn 要等人点，
   15 秒的超时把它卡死了` 正是冲着「能不能停住等人点」来的。**本轮要验的就是它。**
2. `env` → `EAS_AGENT_CHAT_SESSION=ac-2`。查 `src/main/agentChat/session.ts:76` 的
   `let nextId = 1`（主进程模块级，随 app 重启归零）→ 我是这次 app 启动以来的第 2 个
   agent 会话。两个角色 = ac-1 + ac-2，说明**这轮之前这次 app 里没起过任何 agent**，
   app 是刚重启的。
3. 我收到的首条消息逐字匹配 `mcpHandler.ts:665-670` 的 `initialMessage` 模板 →
   本次走的是 `decision.go === true`，**「点算了」这条路本轮又没被走到**（同上轮 F-1）。

## 做了什么

- 通读 `batchRequest.ts`（91e44af 后的版本）、`TeamBatchModal.tsx`、
  `mcpHandler.ts:620-697`、`src/main/mcpBridge.ts:56-92`、`mcp/eas-mcp.mjs:495-507`。
  这轮特意把**整条链路的三层超时**摆到一起看，而不是只看渲染层。
- `grep -rn finishBatch src/` → 确认上轮 F-2 至今**没修**。
- 基线单测：
  ```
  node --test src/renderer/src/features/team/{batchRequest,batchSpec,agentAge}.test.ts
  → tests 22 / pass 22 / fail 0   （73 ms）
  ```
  全绿。本轮查出的两个问题都在这 22 条的覆盖之外。

## 两个实测（不是审读，是真跑出来的）

### 实测一：渲染层那条 9 分钟超时到底会不会触发

`/tmp/cc-timeout-probe.test.mjs` —— 用 `node:test` 的 `mock.timers` 把时钟推过 9 分钟，
断言 `askForBatch` 自己 resolve 成 `go:false` 并清掉 `pending`：

```
✖ 9 分钟没人点 → askForBatch 应当自己超时返回 go:false 并清掉 pending
  AssertionError: 超时后应该已经 resolve（实际：一直挂着）
✔ 对照：用户点了「算了」→ 正常 resolve
```

再把 `batchRequest.ts` 复制一份加日志（`/tmp/batchRequest.probe.ts`）定位根因：

```
[cb] 定时器回调真的跑了；pending?.resolve === resolve ? false | pending 是否为空: false
```

回调跑了、`pending` 还在，但那句守卫的比较恒为 false。→ 见 findings G-1。

### 实测二：MCP shim 那一侧 `fetch` 有没有自己的上限

`mcp/eas-mcp.mjs:499` 是裸 `fetch`，没有 `signal`、没有 `setGlobalDispatcher`
（`grep` 过，`mcp/*.mjs` 里一个都没有）。所以吃 undici 的默认值。
起了个「永不响应」的 http server 让 `fetch` 挂着计时（`/tmp/undici-timeout-probe.mjs`，
node v26.5.0，与 app 内 shim 同一运行时）。结果见 findings G-2。

## 我做不到的事（与上轮相同，先说清楚）

`decision.go` 只活在渲染进程，不会进我的上下文。**「用户点了哪个按钮」我这一侧
永远查不到**。我能证的只是「我被起出来了 ⇒ 本次是 go:true」，反过来不成立的那半
（点了算了却起了进程）我无法排除，只能由看得见弹窗的一方合并判断。
