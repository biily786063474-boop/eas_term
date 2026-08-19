# researcher · 结论

**任务**：验证「确认清单点『算了』→ 取消路径不起任何进程」。

## 一句话结论

代码层面取消路径是干净的（硬 return，起进程的代码在其之后），
**但这一批没有验证到它** —— 我这个 researcher 会话被真的起来了，
说明本次走的是「同意」路径，不是「算了」。

## 证据

### 1. 我的存在，就是本批次走了同意路径的证据

我收到的首条消息与 `src/renderer/src/mcpHandler.ts:620-627` 的 `initialMessage`
模板逐字一致（角色名、「这一批的目标」「你负责」、`.plans/<role>/` 产出约定）。
那段模板只出现在 `openAgentPane` 调用里，而该调用位于 `decision.go` 为真之后。

取消路径在它之前就返回了：

```ts
// mcpHandler.ts:599-605
const decision = await askForBatch({ spec, frameId: where.frameId, cwd: where.projectPath })
if (!decision.go) {
  return { spawned: [], next: `用户没有同意组队…` }
}
// ④ 真的起 —— openAgentPane 在这行之后
```

`if (!decision.go)` 到 `return` 之间没有任何副作用：不 `openAgentPane`、
不 `running.add`（`resolveBatchRequest` 的 else 分支只动 `cancelStreak` / `banned`）、
也不需要 `finishBatch`。**静态看，点「算了」一个进程都不会起。**

### 2. 弹窗按钮接线正确

`TeamBatchModal.tsx:74` 的「算了」→ `resolveBatchRequest({ go: false })`，
与 `tbm-primary` 的 `{ go: true }` 是两个独立按钮，没有共用路径。

### 3. 既有测试：7/7 通过，但覆盖面不含本次要验的那条

```
node --test src/renderer/src/features/team/batchRequest.test.ts
✔ 7 passed / 0 failed
```

七个用例全在 `batchRequest.ts` 的状态机层（拉黑、限流、计数清零）。
**没有一个断言「取消后没有 openAgentPane 调用」** —— 那是 `mcpHandler` 层的行为，
目前只有代码审读，没有自动化守卫。

## 两个要提请 lead 注意的点

### A. 这一批的验证目标没达成

要真验取消路径，得让这个批次**不产生任何 agent 会话**。
只要我（或任何 teammate）被起来了，就说明点的不是「算了」。
判据很干脆：**取消路径的成功标志是「什么都没发生」，不是「有 agent 报告说取消了」。**

### B. 用「点算了」做验证有代价：两次就锁死这个 Frame

`batchRequest.ts:63` —— 连续取消 2 次 → `banned.add(frameId)`。
而 `banned` 的唯一清除入口是 `__resetBatchState()`，它只被测试文件引用，
生产代码里没有调用点。所以**一旦拉黑，只能重载渲染进程 / 重启 app 才能再派活**。

如果打算重复几次验证取消路径，第二次点完「算了」这个 Frame 本轮就废了。
中间穿插一次「同意」可以清零（`cancelStreak.delete`，已有测试覆盖），
但那又会真起进程 —— 两条路都有代价，值得先想清楚验几次。

## 建议

把这条验证从「人点按钮」下沉成 `mcpHandler` 层的单元测试：
mock `askForBatch` 返回 `{ go: false }`，断言 `openAgentPane` 零次调用、
返回值 `spawned` 为空数组。这样既不用消耗 Frame 的取消额度，也能防回归。
