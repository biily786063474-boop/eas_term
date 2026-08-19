# researcher · 过程记录

---

## 第 3 批（本批）

目标：摸清 `src/main/wiki/` 的目录约定、`wiki_query` 数据形状、哪些操作真写盘。
这批和前两批完全无关（前两批是多 agent 编排 / 确认清单超时），
所以把第 1+2 批的结论整体归档到 `archive/round1-2-findings.md`，`findings.md` 只留本批。

### 做了什么

1. `find src/main/wiki` + `wc -l` 摸清规模：10 个文件 2249 行，其中 `index.ts` 718 行最大。
2. **全部读完，一行没跳**（分 4 次并行读）：
   `paths.ts`(225) `taxonomy.ts`(231) `customSchema.ts`(114) `scan.ts`(63) `git.ts`(56)
   `schema.ts`(382) `index.ts`(718)。这个模块的注释密度极高，
   很多"为什么这么写"的判据只存在于注释里（比如收件箱不能 gitignore 的那个洞），读代码不读注释会漏掉一半结论。
3. 追到模块外确认第二问 —— 光看 IPC handler 会得出错误的形状：
   `mcp/eas-mcp.mjs`（工具描述）→ `src/renderer/src/mcpHandler.ts:733`（**重新包了一层，字段被改过**）
   → `src/shared/types.ts`（`WikiStatus` 定义）。agent 收到的和 IPC 返回的不是同一个对象。
4. `grep -rn dirNames src/` 确认调用点：4 处，其中 `schema.ts` 的 3 处全在 `if (!t)` 内置分支里，
   **唯一会在自定义库下被调用的就是 `wiki:query` 的 `dirs` 字段** —— 这一步是坑判断成立的关键。
5. `grep '^test' src/main/wiki/*.test.ts` 看现有 43 条用例覆盖了什么，
   确认没有一条打到 `dirNames`（它引 electron，`node --test` 加载不了）。
6. `node --test 'src/main/wiki/*.test.ts'` → **43 pass / 0 fail**，基线是绿的。

### 判断过程

三问里前两问是纯事实，读完就有答案。第三问"最容易踩坑的一处"筛了 6 个候选：

| 候选 | 为什么没选 |
|---|---|
| `wiki:log` 不受 broken 闸门保护 | log.md 在库根、与分类无关，影响小 |
| `reconcileOnStartup` 启动即写盘 | 真实且容易被忽略，但已有 `looksEmpty` + 幂等两道保险，写进表里加粗即可 |
| `walkNotes` 的 20000 budget 静默截断 | 真坑，但触发门槛高（两万条目），且不在本批三问范围 → 降级到"顺带记下" |
| `isRawName` 只匹配顶层 | 与"禁止斜杠"校验配套，当前自洽 → 同上 |
| "有 library 就忽略 dirs"靠提示词 | 方向对，但说法太笼统，不够具体 |
| **自定义库 `dirs` 的 1 真 7 假** | **选它** |

选最后一个的三条理由：
① 具体到字段（`dirs.inbox` 真 / 另外七个假），不是泛泛的"靠提示词不可靠"；
② 有作用机制 —— 模型抽样核对 `dirs.inbox` 会发现它真的存在，这个"验证通过"反而推它去信任整个 `dirs`；
③ **测不到** —— 全模块最讲究的"纯 node 可测"分层恰好在这个字段上失效，
   意味着它不会被任何回归测试拦住，只会在真实的自定义库上出事。

### 没做的

- 没改任何代码。findings 里给的最小修法只是建议，没动 `index.ts`。
- 没跑真实的自定义库端到端验证（要起 Electron，且会往盘上建库）—— 结论是读代码 + 调用点追踪得出的，
  `dirs` 那条的证据链是：`dirNames` 的实现 + `dirOf` 不读 `.eas-wiki.json` + `grep` 确认唯一调用点。

## 第 2 批

目标：验证确认清单能停住等人点；被要求「这一批点算了」。

### 做了什么

1. 先读自己第 1 批的 `findings.md` / `progress.md`，捡回判据
   （「取消路径的成功标志是什么都没发生」）。
2. `ToolSearch` 找有没有「确认清单」类工具 —— **没有**。
   返回的是 DesignSync / ExitWorktree / RemoteTrigger，都不相干。
   **我在 CLI 侧，点不到那张清单**，这一点和第 1 批一样。
3. 通读 `batchRequest.ts`（111→139 行，比第 1 批长了，05:20 改过）。
   发现新增的 `WAIT_MS = 9min` 和一段解释「必须比主进程短」的注释。
4. 追主进程那侧：`grep -rn invokeRenderer src/` → `mcpBridge.ts:58`。
   读到 `WAITS_FOR_HUMAN = new Set(['wiki_archive_plan','team_spawn'])`，`ms = 10min`。
   **数值不变量成立：9 < 10。**
5. 顺手查 `finishBatch` 调用点，发现只有 catch 里一处 —— 正要当新发现写，
   `grep` 时看见 `.plans/cross-checker/findings.md` 已经报过（F-2）。
   读了它那一节，**改成回归确认，不重复邀功**。只补了「代码在那之后改过、bug 还在」。
6. 重跑 `batchRequest.test.ts` → 7/7（因为文件 05:20 改过，第 1 批的结果不能沿用）。
7. **回头盯 `askForBatch` 那个超时守卫**，发现 `pending?.resolve !== resolve`
   比的是包装器和原始 resolve，恒不相等。
8. 写探针 `.plans/researcher/timeout-probe.test.ts`，用 `t.mock.timers` 推 9 分钟
   → 两条断言全失败，坐实超时分支是死代码、且脏标记会发生。
9. **做反证**：`cp` 一份到 `/tmp/br-fixed.ts`，把守卫换成 `pending.req !== req`，
   同样的探针立刻通过 → 根因锁定在那一行，不是 mock timers 的假象。

### 中途的判断转折

第 5 步差点把 F-2 当自己的发现写进去。`grep -rn finishBatch` 时把 `.plans/` 也扫进来了，
才看见 cross-checker 第 1 批已经写得比我全（连「错误文案指向无效补救动作」都写了）。
改成回归确认之后，反而空出注意力去看第 7 步那个守卫 —— R-1 是这么撞上的。

### 没做的事

- **没有改任何生产代码。**反证用的是 `/tmp/br-fixed.ts` 副本，`src/` 没动过。
- 没有真去点任何按钮（点不到）。
- 没有写别人的目录。只**读**了 `.plans/cross-checker/findings.md`，为了避免重复结论。
- 没把探针搬进 `batchRequest.test.ts` —— 那是改项目测试，等 lead 定。

### 留下的文件

- `.plans/researcher/findings.md` —— 两批累积结论
- `.plans/researcher/progress.md` —— 本文件
- `.plans/researcher/timeout-probe.test.ts` —— 探针，**当前 2 条全红，红即是结论**；
  修好 R-1 后应转绿

---

## 第 1 批（存档）

任务：验证取消路径不起进程（被告知「这是占位任务，不会真的执行」）。

1. `ls` 项目根 + `.plans` —— `.plans` 当时不存在，是我建的第一层。
2. `grep -rl team_spawn` 定位到 5 个文件，取其中三个实现文件：
   `batchRequest.ts`（状态机，通读）、`mcpHandler.ts` 的 team_spawn 五步、`TeamBatchModal.tsx`。
3. 读 `batchRequest.test.ts` 的取消相关用例，跑 `node --test` → 7 passed（实跑，非推断）。
4. `grep banned` 确认拉黑状态无生产清除入口。

转折：读到 `mcpHandler.ts` 的 `initialMessage` 模板时发现它和我收到的首条消息逐字相同 ——
说明我是被 `openAgentPane` 真起的，本批次走的是 `decision.go === true`，取消路径没被触发。
结论从「验证通过」改成「代码审读通过，但本批次实测未达成」。
