# Codex app-server 协议探针

**日期**：2026-08-14　**目的**：评估「让 Codex 也有逐次审批卡片」的真实成本
**结论**：**比预想的大一个量级。建议不做，或只做极小的子集。** 理由见下。

复现方式（都不花钱）：

```bash
codex app-server generate-json-schema --out <DIR>   # 39 个 schema
codex app-server generate-ts --out <DIR>            # 93 个 TS 类型
```

---

## 一、它不是「聊天协议」，是 Codex 桌面应用的整个后端协议

93 个类型、几十种客户端方法，涵盖：文件系统操作（`fs/readFile` `fs/watch` `fs/copy`…）、
插件市场（`marketplace/add` `plugin/install` `pluginShare/*`）、账号登录、MCP 服务器管理、
配置读写、模型列表、权限档案……

我们要的只是其中很小一块（起会话 / 发消息 / 收事件 / 应答审批），但**协议是整体演进的**，
且 `v1` / `v2` 两套并存、标着 experimental。

## 二、服务端会主动向客户端发起 10 种请求（不应答就挂住）

```
applyPatchApproval                       ┐
execCommandApproval                      │
item/commandExecution/requestApproval    ├─ 5 种审批
item/fileChange/requestApproval          │
item/permissions/requestApproval         ┘
item/tool/requestUserInput               ← 问答，不是审批
item/tool/call                           ← 要客户端代为执行工具
mcpServer/elicitation/request            ← MCP 询问
account/chatgptAuthTokens/refresh        ┐ 基础设施
attestation/generate                     ┘
```

握手是 `InitializeParams { clientInfo, capabilities }` —— **有 capabilities 协商**，
理论上可以声明只支持一部分，从而让服务端不发其余的。**这一条没有实测验证过**，
是这个方向唯一可能把范围压下来的杠杆。

## 三、五种审批的决定集**互不相同**，我们的中间模型装不下

| 审批 | 可选决定 |
|---|---|
| `ApplyPatchApproval` | `allow` / `deny` / `approved` / **`approved_for_session`** / `timed_out` / `abort` |
| `CommandExecutionRequestApproval` | `accept` / **`acceptForSession`** / `decline` / `cancel` |
| `ExecCommandApproval` | 同 ApplyPatch |
| `FileChangeRequestApproval` | `accept` / **`acceptForSession`** / `decline` / `cancel` |
| `PermissionsRequestApproval` | **`read` / `write` / `deny`** + 作用域（`path` `glob_pattern` `root` `project_roots` `tmpdir` `slash_tmp`）+ 时效（`turn` / `session`） |
| `ToolRequestUserInput` | 不是决定，是 `questions` → `answers`；带 `autoResolutionMs` / `isBlocking` |

而 `src/shared/agentChat.ts` 现在是：

```ts
| { k: 'approval.resolved'; approvalId: string; decision: 'allow' | 'deny' }
```

**缺三样东西**：

1. **「本次会话都允许」** —— `approved_for_session` / `acceptForSession`。这是个真实且常用的
   第三种决定，Claude 侧的 hook 也有对应概念（`permissionDecision` 之外还有 settings 里的
   allow 列表），但我们从没建模过
2. **读/写分级 + 作用域 + 时效** —— `PermissionsRequestApproval` 根本不是二元的，
   它是「授予对某个路径/glob 的读还是写、这一轮还是整个会话」
3. **问答** —— `ToolRequestUserInput` 要用户**填内容**，不是点允许/拒绝。UI 形态完全不同

## 四、成本与收益

**收益**：Codex 用户从「三档沙箱」升级到「逐次审批卡片」。

**成本**（保守估计）：
- 实现一个双向 JSON-RPC 客户端（服务端会主动请求，不是单向事件流）
- 应答 10 种服务端请求，其中 5 种审批各有不同决定集
- 扩展中间事件模型（三处，见上），**而中间模型是子项目 B 的 UI 直接依赖的**
- 协议 experimental + v1/v2 并存，**上游改了我们就得跟**

对比 Claude 侧：一个 hook 脚本 + 一个二元决定，就够了。

## 五、建议

**方案 A（推荐）：不做，保持现状。**
Codex 继续走 `exec --json` + 三档沙箱（`read-only` / `workspace-write` / `danger-full-access`）。
能力声明机制已经让 UI 自动退回沙箱选择，**不需要为此改任何 UI 代码**。
把力气花在子项目 B（对话界面）上——那是用户能看见的部分，而且 Ruling 14/15 承诺的两个
安全提示目前还没有界面兑现。

**方案 B：先验 capabilities 协商能压到多小。**
握手时声明只支持 `item/commandExecution/requestApproval` + `item/fileChange/requestApproval`
两种，看服务端会不会就不发其余的。**若能压到两种、且都是 accept/decline 二元**，
成本会降到「一个 adapter + 中间模型加一个 `approvalForSession` 决定」的量级，那就值得做。
这一步的探测成本很小（一次握手），是继续这个方向前唯一该做的事。

**方案 C：全做。** 不建议。它会让中间事件模型为一个 experimental 协议大幅复杂化，
而那个模型是子项目 B 的 UI 直接依赖的——UI 还没写，先被协议细节绑住不划算。

---

## 六、这次探针没做的事

- **没有真的连上 app-server 跑一轮**（需要先实现 JSON-RPC 握手，成本已超出探针范畴）
- **没有验证 capabilities 协商的实际效果**（方案 B 的前提）
- 没有确认日常任务实际会触发上面 10 种中的哪几种
