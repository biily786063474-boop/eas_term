# researcher · 结论（累积：第 1 批 + 第 2 批）

---

# 第 2 批（本批）

**批次目标**：验证确认清单能停住等人点 —— 这一批请点「算了」。

## 一句话结论

清单确实能停住等人点，**但它停得太住了** ——
渲染层那道「9 分钟自动放弃」的保险丝是**哑的**，超时分支永远执行不到；
后果是 05:20 那次修复想避免的 `running` 脏标记**照样会发生**。
另外，「这一批点算了」**第二次没达成**：我又被起来了，走的还是同意路径。

## R-1【真 bug · 新发现】9 分钟超时分支是死代码

`batchRequest.ts:111-118`：

```ts
return new Promise<BatchDecision>((resolve) => {        // ← resolve = R0
  const timer = setTimeout(() => {
    if (pending?.resolve !== resolve) return            // ← 恒为 true，永远 return
    pending = null; emit()
    resolve({ go: false, reason: '清单一直没人处理（等了 9 分钟）' })
  }, WAIT_MS)
  pending = {
    req,
    resolve: (d) => { clearTimeout(timer); resolve(d) } // ← W0，包装 R0 的新函数
  }
})
```

守卫比较的是 `pending.resolve`（包装器 `W0`）和 Promise 的原始 `resolve`（`R0`）。
**这两个永远不是同一个函数引用**，所以 `!==` 恒为真，超时回调一进来就 `return`。
9 分钟到点后什么都不做：Promise 继续挂着，弹窗继续留在屏幕上。

### 实证（不是代码审读，是跑出来的）

探针留在 `.plans/researcher/timeout-probe.test.ts`，用 `t.mock.timers` 推进 9 分钟：

```
$ npx tsx --test .plans/researcher/timeout-probe.test.ts
✖ 9 分钟没人点 → askForBatch 应当自己 resolve 成 go:false
    AssertionError: 超时分支没有执行：Promise 仍然挂着，弹窗不会自己消失
✖ 超时之后用户才点「开工」→ running 不该被脏标记
    AssertionError: running 被脏标记了 —— 这个 Frame 之后永远派不了活
    actual: true, expected: false
ℹ pass 0 / fail 2
```

**两条断言写的都是「正确行为」，所以失败 = bug 存在。**修好后它们应转绿，
可以直接搬进 `batchRequest.test.ts` 当回归守卫。

反证（把守卫换成比较 `req` 之后，副本立刻通过，确认根因就是这一行）：

```
$ npx tsx --test /tmp/br-probe.test.ts     # /tmp/br-fixed.ts 里 :112 改成 if (!pending || pending.req !== req) return
✔ 反证：守卫改成比较 req 之后，超时分支就执行了
ℹ pass 1 / fail 0
```

### 为什么这条要紧：它让 05:20 那次修复没生效

`batchRequest.ts:85-93` 的注释把危害写得很清楚，原话是：

> 主进程 invokeRenderer 超时后只清它自己那份 pending，渲染层这边的弹窗还挂着。
> 用户过一会儿点了「开工」→ running.add 执行 → 这个 Frame 被标记成「有批次在跑」，
> 可实际一个 agent 都没起，之后再派活永远被「已经有一批在跑」挡住，除非重启 app。

`WAIT_MS = 9min < 主进程 10min`（`mcpBridge.ts:73`，`WAITS_FOR_HUMAN` 集合里有 `team_spawn`）
这个**数值上的**不变量我核了，是成立的。但它不起作用 —— 因为渲染层压根不会超时。
时间线仍然是：

1. 清单弹出，用户离开电脑
2. 第 10 分钟：主进程超时，给 AI 回「用户一直没有处理那张派活清单」→ AI 转单会话
3. 弹窗**还在屏幕上**（渲染层从没超时）
4. 用户回来，看见清单，点「开工」→ `running.add(frameId)`
5. 一个 agent 都没起（AI 早走了），但这个 Frame 已被标记「有批次在跑」
6. 之后所有 `team_spawn` 被挡，且**没有任何清除入口**（见 F-2）→ 只能重启 app

第 4 步这个「过期弹窗还能点」本身也该修：超时后该把清单撤掉，或者标成失效。

### 修的方向

守卫的本意是「pending 已被别人换掉就别动」，那就该比较**能唯一标识这次调用的东西**：

```ts
const self = { req, resolve: (d) => { clearTimeout(timer); resolve(d) } }
const timer = setTimeout(() => {
  if (pending !== self) return          // 比对象引用，不是比 resolve
  ...
}, WAIT_MS)
pending = self
```

（`let done = false` 的写法也行。别再拿 `pending.resolve` 跟 `resolve` 比。）

## R-2【回归确认】cross-checker 的 F-2 在改动后的代码上依然存在

这不是我的发现，是 cross-checker 第 1 批报的（`running` 成功路径永不归还）。
我的增量只有一条：**代码在那之后动过（`batchRequest.ts` 05:20 改），F-2 没被修。**
它报的行号 `mcpHandler.ts:639` 现在是 `:685`，`finishBatch` 仍然只有那一个 catch 里的调用点；
`TeamPanel.tsx` 的 import 列表里仍然没有 `batchRequest`（第 12-17 行，我逐行看过）。

R-1 和 F-2 是**叠加**的：R-1 制造脏标记，F-2 保证这个脏标记永远清不掉。

## R-3 本批次「点算了」再次未达成 —— 但这次有个跨批次旁证

判据还是第 1 批那条：**取消路径的成功标志是「什么都没发生」。**
我这个会话存在 → `decision.go === true` → 点的是「开工」。第二次了。

不过这次多出一个第 1 批拿不到的事实：**上一批（05:18）已经在同一个项目成功派过一次活。**
按 F-2，那次之后 `running` 里就该留着这个 frameId，这一批的清单**根本弹不出来**才对
（`askForBatch` 会抛「这个项目已经有一批 agent 在跑了」）。可它弹出来了。
所以两者必居其一：

- 中间重载过渲染进程 / 重启过 app（模块级 `running` 被清空），或
- 这一批派在了**另一个 Frame** 上

无论哪个，都反过来印证 F-2 的严重性：**同一个 Frame 想派第二次活，得先重启。**
这条是运行时旁证，比静态审读硬一档。lead 若知道中间是否重启过，可以直接闭合。

## 给 lead 的建议（按优先级）

1. **先修 R-1**（一行守卫），它是「修了但没生效」，风险最高 —— 注释已经把危害写全了，
   容易让人以为这条路已经堵上。
2. **再定 F-2 的语义**（cross-checker 给了两个选项，取舍归你）。
3. 顺手加「超时后撤掉/失效化弹窗」，堵住「过期清单还能点」。
4. `.plans/researcher/timeout-probe.test.ts` 两条断言修完就转绿，建议搬进
   `batchRequest.test.ts` 常驻 —— 现有 7 条测试全在状态机层，**没有一条覆盖超时**。

---

# 第 1 批（存档）

**任务**：验证「确认清单点『算了』→ 取消路径不起任何进程」。

**结论**：代码层面取消路径是干净的（硬 `return`，起进程的代码在其之后），
但这一批没有验证到它 —— 我被真的起来了，说明走的是「同意」路径。

- `mcpHandler.ts` 的 `if (!decision.go)` 到 `return` 之间没有任何副作用：
  不 `openAgentPane`、不 `running.add`、也不需要 `finishBatch`。静态看，点「算了」一个进程都不会起。
- `TeamBatchModal.tsx:74` 的「算了」→ `resolveBatchRequest({ go: false })`，
  与 `tbm-primary` 的 `{ go: true }` 是两个独立按钮，没有共用路径。
- `batchRequest.test.ts` 7/7 通过（本批重跑仍 7/7），但七条全在状态机层，
  **没有一条断言「取消后没有 openAgentPane 调用」**。
- 提醒：`CANCEL_LIMIT = 2`，连续取消两次就拉黑这个 Frame，
  而 `banned` 的唯一清除入口 `__resetBatchState()` 只被测试引用 —— 拿「点算了」做验证有额度代价。
