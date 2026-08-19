# cross-checker · 结论（第二轮，0.4.32）

> 一句话：**清单确实会停住等人点，但只能等 5 分钟，不是设计里写的 9/10 分钟** ——
> 91e44af 补的那条渲染层超时是死代码（实测证明），而真正最短的一道闸在
> 谁都没算进去的第三层：MCP shim 的裸 `fetch`（undici 默认 300 秒）。
> 另外：**这个 Frame 现在已经被锁死了，你原本要做的「点算了」实验在这里做不了**。

编号接上一轮（上轮 F-1…F-4，见 `git show 91e44af:.plans/cross-checker/progress.md`）。

## 测试基线

```
node --test src/renderer/src/features/team/{batchRequest,batchSpec,agentAge}.test.ts
→ tests 22 / pass 22 / fail 0   （73 ms）
```
绿。下面三条都在这 22 条的覆盖之外。

## G-0 先说挡在你路上的那件事：这个 Frame 已经不能再派活了

上一轮的 **F-2 至今没修**，而本轮这批「开工」刚好把它触发了：

```
$ grep -rn "finishBatch" src/
src/renderer/src/mcpHandler.ts:8     import { askForBatch, finishBatch } ...
src/renderer/src/mcpHandler.ts:685   finishBatch(where.frameId)   ← 只在「起到一半失败」的 catch 里
src/renderer/src/features/team/batchRequest.ts:70   定义
```

`mcpHandler.ts:689` 的**成功 return 不调 `finishBatch`**；`TeamPanel.tsx:41` 的停会话
走 `window.api.agentChat.stop(r.id)`，也没引入 `batchRequest`。
所以我和另一个角色被起出来的那一刻，`running` 就永久记下了这个 frameId。

**后果就在眼前**：你接下来再让 AI 调一次 `team_spawn` 想点「算了」，
`askForBatch` 会在弹窗之前就抛 ——

> 这个项目已经有一批 agent 在跑了。等它收尾，或者让用户在团队面板里停掉

**清单根本不会出现**，你没有按钮可点。而且那句提示指向的补救动作（去面板里停掉）
跟这个闸门没接线，停多少次都没用。唯一出路是重启 app，或换一个 Frame 测。

顺带一条佐证：我的 `EAS_AGENT_CHAT_SESSION=ac-2`，而 `session.ts:76` 是
`let nextId = 1`（主进程模块级，随 app 重启归零）。也就是说这次 app 启动以来
只起过 2 个 agent 会话 = 本批的两个 —— 上一轮和这一轮之间隔着一次 app 重启。
这正是 F-2 会逼出来的节奏：**每派一批就得重启一次**。

## G-1 渲染层那条 9 分钟超时是死代码，一次都不会触发【实测确认】

91e44af 的提交信息说得很清楚，它要防的是：主进程超时后弹窗还挂着，用户过一会儿
点「开工」→ `running` 被脏标记 → 之后永远派不了活。对策是「渲染层自己也要超时，
且必须比主进程那侧短（9 分钟 vs 10 分钟）」。

**这条对策没有生效。** `batchRequest.ts:110-124`：

```ts
return new Promise<BatchDecision>((resolve) => {
  const timer = setTimeout(() => {
    if (pending?.resolve !== resolve) return   // ← 恒为 true，永远从这儿返回
    ...
  }, WAIT_MS)
  pending = {
    req,
    resolve: (d) => { clearTimeout(timer); resolve(d) }   // ← 存进去的是这个包装闭包
  }
})
```

`pending.resolve` 存的是**包装闭包**，`resolve` 是 Promise 的原始 resolve，
两者永远不是同一个引用。守卫的本意是「这张 pending 还是不是我的」，
写成了一个恒不相等的比较，于是超时回调每次都直接 `return` —— 不清 `pending`、
不 `emit`、不 resolve。

实测（`/tmp/cc-timeout-probe.test.mjs`，用 `node:test` 的 `mock.timers` 把时钟推过 9 分钟）：

```
✖ 9 分钟没人点 → askForBatch 应当自己超时返回 go:false 并清掉 pending
  AssertionError: 超时后应该已经 resolve（实际：一直挂着）
✔ 对照：用户点了「算了」→ 正常 resolve
```

再复制一份加日志定位根因（`/tmp/batchRequest.probe.ts`）：

```
[cb] 定时器回调真的跑了；pending?.resolve === resolve ? false | pending 是否为空: false
```

回调跑了、`pending` 还在、比较是 false。**根因确认，不是推断。**

### 修法（一行）

守卫要比一个稳定的身份，而不是比 resolve：

```ts
const mine = { req, resolve: (d: BatchDecision) => { clearTimeout(timer); resolve(d) } }
// ...
if (pending !== mine) return      // 或者 if (pending?.req !== req) return
pending = mine
```

（`timer` 与 `mine` 互相引用，实际写的时候用 `let timer` 先声明。）

### 建议把这条实测收进仓库

现有 7 条 `batchRequest.test.ts` 全在状态机层，没有一条碰超时 —— 所以这个 bug
才能带着「711 全过」的提交信息进来。把 `/tmp/cc-timeout-probe.test.mjs` 里那条
用例（`mock.timers` + 推过 `WAIT_MS` + 断言 resolve）搬进
`batchRequest.test.ts` 就能守住。我没有直接改仓库里的文件（本批是验证任务）。

## G-2 真正最短的一道闸在第三层：MCP shim 的 `fetch`，5 分钟【实测确认】

`mcpBridge.ts` 的注释只把链路当成两层（渲染层 / 主进程）。实际是**三层**，
而最外面那层最短：

| 层 | 位置 | 上限 | 实际行为 |
|---|---|---|---|
| ① MCP shim | `mcp/eas-mcp.mjs:499` 裸 `fetch` | **300 秒** | undici 默认 `headersTimeout`，**最先炸** |
| ② 渲染层 | `batchRequest.ts` `WAIT_MS` | 9 分钟（名义） | **永不触发**（G-1） |
| ③ 主进程 | `mcpBridge.ts` `WAITS_FOR_HUMAN` | 10 分钟 | 会触发，但已经太晚 |

实测（`/tmp/undici-timeout-probe.mjs`，node v26.5.0，与 app 内 shim 同一运行时；
起一个永不响应的 http server 让 `fetch` 挂着计时）：

```
[probe] REJECT elapsed=300.8s name=TypeError msg=fetch failed cause=UND_ERR_HEADERS_TIMEOUT
```

`grep` 确认 `mcp/*.mjs` 里没有 `setGlobalDispatcher`、也没给 `fetch` 传 `signal`，
所以吃的就是这个默认值。

**用户视角**：清单弹出来 5 分钟内点，一切正常；**超过 5 分钟再点，就开始出怪事。**

- AI 那侧在第 300 秒收到 `{ isError: true, text: "fetch failed" }`
  （`eas-mcp.mjs:548`）—— 一句没有任何指引的报错，跟同项目里
  「每条错误都写清为什么不行、现在该做什么」的规矩完全相反。AI 多半会重试，
  重试撞上「已经有一张批次清单在等用户确认了」。
- 弹窗**还挂在屏幕上**。用户第 6 分钟点「开工」→ 渲染层照常执行 `openAgentPane`，
  **agent 真的起来了**；结果通过 IPC 回到主进程时 `pending` 还在（10 分钟没到），
  主进程写 HTTP 响应，但 shim 那边的 `fetch` 已经断了，响应没人接。
  → **进程起了、AI 以为失败了、`running` 被标记且永不释放（G-0）。**
  这正是 91e44af 想消灭的那个场景，只是把触发时间从 15 秒挪到了 5 分钟。

### 修法

超时阶梯必须是 **shim > 主进程 > 渲染层**，现在是完全倒的。两处一起改：

1. shim 侧给「等人点」的工具一个显式、更长的上限，别吃默认值：
   ```js
   const WAITS_FOR_HUMAN = new Set(['wiki_archive_plan', 'team_spawn'])
   const res = await fetch(url, {
     ...,
     signal: AbortSignal.timeout(WAITS_FOR_HUMAN.has(tool) ? 11 * 60_000 : 30_000)
   })
   ```
   这个清单和 `mcpBridge.ts` 里那个是**同一份语义、两个地方**，
   改一处漏一处就会重演今天这一幕 —— 值得在两边互相写一句注释指过去。
2. 顺手把 `catch` 里的 `fetch failed` 翻译成人话（区分「超时」和「app 没在跑」），
   否则 AI 拿到的永远是那三个字。

## G-3 多角色清单渲染：这一路是通的

`TeamBatchModal.tsx:51-58` 用 `spec.agents.map` 逐行渲染、`key={a.role}`；
`batchSpec.ts` 侧有 role 去重（用例「role 重名要拒」已通过），所以 key 不会撞。
样式上 `.tbm` 是 `max-height: calc(100vh - 60px); overflow-y: auto`，
6 个（`MAX_AGENTS`）撑不爆、按钮不会被挤出可视区。

我确实是**两个角色之一**被起出来的 —— 本批的这个目标达成了。

## G-4 「点算了」这条路本轮又没验到（同上轮 F-1，原因不同）

我在这儿，就说明本次是 `decision.go === true`。`decision.go` 只活在渲染进程、
不会进我的上下文，所以「用户点的是开工」和「点了算了却仍然起了进程」这两种，
**我这一侧永远分不出来**。要闭合这个结论只有两条路：

- 你补一句「我按的是哪个」；
- 或者按上一轮 researcher 的建议把它下沉成单测：mock `askForBatch` 返回
  `{go:false}`，断言 `openAgentPane` 零次调用。**这条更值** ——
  取消路径的成功标志是「什么都没发生」，而「什么都没发生」天然没人报告，
  靠人点按钮永远验不牢。

另外提醒一条上轮就写过的（`CANCEL_LIMIT = 2`）：连点两次「算了」→ 这个 Frame
进 `banned`，弹窗再也不出，且没有任何 UI 能解除。想连着测取消路径，两次就到顶。

## 建议的处理顺序

1. **G-0（阻塞）**：先决定 `finishBatch` 接在哪，否则你连下一次实验都开不了。
   最小改动是成功 return 前调一次；按 `batchRequest.ts` 顶部注释的原意
   （防的是并发烧钱）则应该接在 agent 全部收尾处。这个取舍是你的，我不替你选。
2. **G-1（一行 + 一条测试）**：守卫比错了对象，改完顺手把 mock.timers 那条用例收进仓库。
3. **G-2（两处）**：shim 加显式超时，把阶梯正过来；顺带把 `fetch failed` 翻译成人话。
4. 想立刻做「点算了」实验：**换一个 Frame**，或重启 app 后第一件事就做它。
