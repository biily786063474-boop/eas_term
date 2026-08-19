# cross-checker · 结论

> 一句话：**取消路径在代码上是干净的（静态审查通过），但我这一侧无法证明这次用户
> 实际按了哪个按钮**；顺带查出一个确定的真 bug —— 成功起完一批后 `running` 永不归还，
> 一个 Frame 这辈子只能派一次活。

## 测试基线

```
node --test 'src/renderer/src/features/team/*.test.ts'
→ tests 22 / pass 22 / fail 0   （agentAge / batchRequest / batchSpec 三个文件）
```
绿。下面的问题都不在现有测试的覆盖范围里。

附注（跑题但值得记一笔）：同样这 22 个用例，**用 glob 交给 node test runner 要 540 秒，
逐个文件点名只要 66 毫秒**（两次都实测过）。差 8000 倍不像是用例本身慢。
项目的 `npm test` 正是 glob 写法（`node --test 'src/**/*.test.ts'`），
范围比这个还大。不在我这批的范围里，只是提醒一句：
谁要是觉得「这项目测试跑不动」，先怀疑 glob，别怀疑用例。

## F-1 取消路径：代码层面确认不起进程（静态）

`mcpHandler.ts:574` 的 `team_spawn` 是五段式，起进程在第 ④ 段：

| 段 | 做什么 | 会起进程吗 |
|---|---|---|
| ① | 读 Frame 的多 agent 总闸，关着就 throw | 否 |
| ② | `checkBatch()` 纯函数校验，不合格整批 throw | 否 |
| ③ | `await askForBatch()` 弹清单等决定 | 否 |
| — | `if (!decision.go) return { spawned: [], ... }` | **早返回** |
| ④ | `for (const a of spec.agents) await openAgentPane(...)` | 是 |

`openAgentPane` 是这条路上**唯一**起进程的调用，它在早返回之后。
状态侧也对得上：`batchRequest.ts:52` 的 `resolveBatchRequest`，`go:false` 分支只累计
`cancelStreak`，不碰 `running`、不碰 `spawned`。UI 侧 `TeamBatchModal.tsx:74` 的
「算了」按钮直连 `resolveBatchRequest({ go: false })`，没有别的副作用。

**结论：只要走的是「算了」，一个进程都不会起。这一条静态可证。**

### 但这次实验没能验到它

我是被 `openAgentPane` 起出来的 —— 我收到的首条消息逐字匹配
`mcpHandler.ts:620-628` 的 `initialMessage` 模板。也就是说这次调用**走进了第 ④ 段**，
即 `decision.go === true`。

有两种解释，我分不出是哪种：

- **(a)** 用户实际点的是「开工」，这次取消实验根本没执行（大概率）；
- **(b)** 用户点了「算了」而进程照起了 —— 那 F-1 的静态结论就是错的。

`decision.go` 只存在于渲染进程，不会进我的上下文，我**没有任何办法**从 agent 侧
区分 (a) 和 (b)。**请由看得见弹窗的一方补一句「我按的是哪个」**，这个结论才闭合。
如果答案是「我按的是算了」，那就是 P0，得回头查 `TeamBatchModal` 的按钮绑定
和 `pending` 是否被重复 resolve。

## F-2 成功起完一批后 `running` 永不归还 —— 一个 Frame 只能派一次活【真 bug】

`finishBatch()` 在**整个生产代码里只有一个调用点**：

```
$ grep -rn "finishBatch" src/ --include=*.ts --include=*.tsx
src/renderer/src/mcpHandler.ts:8      import { askForBatch, finishBatch } ...
src/renderer/src/mcpHandler.ts:639    finishBatch(where.frameId)   ← 只在「起到一半失败」的 catch 里
src/renderer/src/features/team/batchRequest.ts:70   定义
```

`mcpHandler.ts:646` 的成功 return 路径**不调 `finishBatch`**。
`TeamPanel.tsx` 的停会话按钮走的是 `window.api.agentChat.stop(r.id)`，
也完全没有引入 `batchRequest` 模块。

复现：

1. Frame 开着多 agent 开关，AI 调 `team_spawn`，用户点「开工」
   → `resolveBatchRequest({go:true})` 执行 `running.add(frameId)`
2. 这一批全部起成功 → 直接 return，`running` 里留下这个 frameId
3. agent 各自干完活，用户在团队面板把它们**全部停掉**
4. AI 再调一次 `team_spawn` → `askForBatch` 抛：
   > 「这个项目已经有一批 agent 在跑了。等它收尾，或者让用户在团队面板里停掉」
5. 用户照着做了（第 3 步就做过），**再试还是同一句**。只能重启 app。

比状态泄漏本身更糟的是**错误文案主动指向了一个无效的补救动作** ——
用户会反复去面板里停，越停越困惑，而那个按钮跟这个闸门根本没接线。

现有测试测不到，因为 `batchRequest.test.ts:33` / `:66` 是测试**自己**手动调
`finishBatch('f1')` 来推进状态的；生产里没有对应的调用者。

修的方向（两选一，别都做）：
- 成功 return 前调 `finishBatch(where.frameId)`，把「一批」定义成「起完就算收尾」；
- 或者保持「跑完才算收尾」的语义，在 TeamPanel 停会话 / agent 自然结束处接线，
  并且要处理「只停了一部分」的情况。

按 `batchRequest.ts` 顶部注释的原意（「上一批没收尾，不许开下一批」，防的是并发烧钱），
第二种才是本意；但第一种改动小、不会把 Frame 锁死。**这个取舍要你定，我不替你选。**

## F-3 多角色清单渲染：这次验到了，没问题

批次目标里那句「两行是为了看清单能不能正确列出多个角色」——
`TeamBatchModal.tsx:52` 用 `spec.agents.map` 逐行渲染，`key={a.role}`；
`batchSpec.ts` 有 `seen` 集合做 role 去重（`batchSpec.test.ts` 里有对应用例，已通过），
所以 key 不会撞。我确实是**两个角色之一**被起出来的，说明多行清单这一路是通的。

## F-4 这个取消实验在同一个 Frame 里最多只能做两次【测试计划注意】

`batchRequest.ts` 的 `CANCEL_LIMIT = 2`：连续两次「算了」就把 frameId 加进 `banned`，
之后 `askForBatch` 直接 throw、**弹窗再也不出来**，且没有任何 UI 能解除 —— 只能重启 app。

所以如果你打算「点算了 → 确认没起进程 → 再跑一次确认」，第二次之后就哑了。
那不是取消路径坏了，是限流生效了。别把它误判成 bug。
想连着测就换个 Frame，或在两次之间穿插一次「开工」（`go:true` 会清零 `cancelStreak`）。

## 建议的下一步

1. 先回答 F-1 那个问题：这次你按的是「算了」还是「开工」。它决定 F-1 是「已验证」
   还是「P0 待查」。
2. F-2 与本批目标无关但更硬，建议单独开一条修。
