# 笔纵画板 MCP 接入（Eas-Term 侧）

> **上游权威文档**：`~/Biily/Projects/taptv pad/docs/MCP_INTEGRATION.md`
> （2026-08-18 更新到 377 行，对应画板 ≥ 1.21.26）。
> 这份只记**跟 Eas-Term 相关的部分**和我们这边做了什么，接口细节以上游为准，别在这里复述一遍再各自漂移。
>
> **写内置 skill 的方法论**：`~/.claude/playbook/MCP-skill编写要点-画板实践.md`
> （2026-08-19，因手册缺陷连续两次静默失败、白花 196+138 墨水后的复盘）。
> 五条检查表：① 不留过期的否定断言（agent 看到「做不到」会直接放弃整条路径且不去验证）
> ② 静默失败点要给可验证判据（`ok:true` ≠ 语义成功）③ 名字有歧义的工具要点名反例
> ④ 产物落地路径写死 ⑤ 别把 harness 的限制写成本系统的限制。
> **改 `skills/eas-term/generate.md` 之前先过一遍那张表。**

## 硬事实（会省两小时的那几条）

| | |
|---|---|
| **画板 < 1.21.20 一律连不上** | `.app` 里没带 `mcpServer` 的运行时依赖，客户端报 `-32000 Connection closed` |
| **< 1.21.22 改不了提示词** | `update_node({prompt})` 被静默丢弃、`get_node` 也读不到当前提示词。症状是「改提示词总是失败」且毫无线索 |
| **< 1.21.26 拿不到报价** | `generate` 返回里没有 `estimate` 字段。那时报价只能靠画板弹窗 |
| **< 1.21.29 视频参考图会被静默丢弃** | 节点连了图但 `generate` 漏传 `mode`，系统按模型第一个模式兜底成 `t2v`，图不进请求体。**报价一分不差**（实测 823 → 823），返回值里看不出来。1.21.29 起硬拦 `MODE_REJECTS_MEDIA_INPUT` |
| **本机现装 1.21.26**（2026-08-19 核对） | 上面两条对本机都不成立，报价路径可用 |
| **画板 app 必须正在运行** | `mcpServer.js` 只是转发器，真正干活的是画板进程的本地 HTTP API |
| **不该依赖用户装 node** | 用画板自带的 Electron（`ELECTRON_RUN_AS_NODE=1`），内置 node v22 |
| **`generate` 默认不会真的开始** | 两阶段设计防误扣费，必须再走一个出口，见下 |

健康检查（诊断连不上时先跑这条）：

```bash
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:13140/
# 000 = 画板没开    401 = 正常（要 token，符合预期）
```

## Eas-Term 写出去的配置

`src/main/mcpBridge.ts` 的 `bizoneRunner()`，形状照上游文档：

```json
"bizone-canvas": {
  "type": "stdio",
  "command": "/Applications/笔纵画板.app/Contents/MacOS/笔纵画板",
  "args": ["<Eas-Term>/Contents/Resources/mcp/bizone-mcp.mjs",
           "/Applications/笔纵画板.app/Contents/Resources/app/electron/mcpServer.js"],
  "env": { "ELECTRON_RUN_AS_NODE": "1" }
}
```

与上游文档的**唯一差别**：args 中间夹了一层 `mcp/bizone-mcp.mjs`（我们的包装器）。

## 我们这边额外做的两件事

**① 依赖自检**（`bizoneServerPath()`）
只有 `mcpServer.js` **和** `app/node_modules/@modelcontextprotocol/sdk` 都在才写配置。
查行为不查版本号：版本号会随上游改，「依赖在不在」才是真判据。
不通过时**不写、也不删已有条目**——用户可能自己手工指到了别处，删了反而把能用的弄坏。

**② 启动包装器**（`mcp/bizone-mcp.mjs`）
调用前探端口，画板没开就 `open -g -a`（不抢前台）拉起来，轮询至多 12s 再交棒。
上游文档把「画板必须在跑」列为硬事实、没给解法——这层就是解法。
两条硬约束写在文件头：**不许碰 stdout**（那是 MCP 传输通道）、**零外部依赖**
（它由 extraResources 原样拷进包，旁边没有 node_modules）。

## 生成流程：1.21.26 起变了（这条对 Eas-Term 影响最大）

`generate` 默认只写参数、节点停在 `idle`。**只调 generate 然后轮询 = 永远等不到结果。**

**1.21.26 起 `generate` 会把价格一起返回**，于是报价和确认都能在 Eas-Term 的对话里完成，
不必再把用户赶回画板点按钮 —— 这正是我们最需要的那条路（用户在这边聊天，
切 app 去确认是最难受的一步）。

| 出口 | 调用 | 场景 |
|---|---|---|
| **报价确认（默认）** | `generate(...)` 读 `estimate.credits` → 报给用户 → `generate_now()` | 有人在场就走它 |
| 画板弹窗 | `generate(...)` → `confirm_batch_generate()` | 用户正看着画板、想在那边核对。**没人看着就别用**，没人去点会卡死 |
| 无人值守 | `generate(..., autoConfirm: true)` | **会真实扣费且用户看不到价格**，只在确定无人时用 |

**`estimate` 三种结果含义完全不同，中间那种最容易误判：**

- `credits` 是数字 → 报价，等确认
- `credits: null` + `note` → **按用量计费，仍然可以生成**，别换模型
- `estimate_error` 有值 → 真估不出来。**若是套餐过期/没墨水，引导充值 —— 换模型没用**

> 这里原来写的是「`estimate_failed` …换模型或退回人工确认」。**那条建议现在是错的** ——
> 上游明说早期版本把配额耗尽也归进估价失败，结果 agent 一路换模型换到底，其实是钱没了。

其余坑（`connect_nodes` 用 `from`/`to`、上游有媒体必须在 prompt 里写 `@N`、
**视频还要额外传 `mode`**、prompt 用中文、本地文件用 `import_local_file`）
写在 **`skills/eas-term/generate.md`**（渐进式披露拆分后
从 SKILL.md 挪过去的），那份会同时下发给 Claude（skill）和 Codex（`~/.eas/agent/`）。
**改要改那一份，别在这里补。**

## 上游新增的「给 agent 写规则时的决策表」

上游 4.5 节直接列出了「必须写进 agent 规则、不写就会卡」的条目 —— 已照抄要点进
`skills/eas-term/generate.md` 的「意图 → 该调什么」那张表。
上游改了这一节要跟着同步，那是唯一一处上游主动为集成方写的内容。

## 变更记录

- **2026-08-26 上游补 `mode`（画板 1.21.29）—— 这次是文档本身教错了，不只是没写。**
  上游两个 commit：`5b4405d` 修代码（`generate` 补 `mode` + 媒体/模式一致性硬拦），
  `a1ac142` 修四份文档。跟着改了 `skills/eas-term/generate.md`：
  ① **视频节点连了媒体必须显式传 `mode`** —— 连线只让媒体成为**候选**，`mode` 才决定
     它进不进请求体。漏传时按模型第一个模式兜底，视频模型第一个基本都是 `t2v`（纯文生），
     参考图被直接丢掉
  ② **点破价格判据的适用边界** —— 本文原有的三条判据里，「报价比纯文生贵」是在**图片**
     链路上实测的（138 → 179）。视频上这条**直接失效**：实测纯文生 823、带参考图还是 823，
     一分不差。外部 agent 白烧两轮就是栽在这。视频改用「同节点换纯文生模式再估一次价，
     价格没变 = 图没进请求」
  ③ **澄清 `media_ref_map` / `targetMediaRefs` 的证明力** —— 它们只说明**连线被认出来了**，
     不是媒体进了请求体的证据。那次误判正源于把两者当成一回事
  ④ **`list_models` 要看 `modes[].inputs`，不是模型级 `inputs`** —— 模型级写着收 image，
     它的默认 mode 仍可能只收文本，这两个是两回事
  > 上游 commit 里点破了心智模型的来源：图片链路的解法是「prompt 里写 `@1`」，
  > 那对图片成立（图片模型靠有没有图自动切 edit 端点），**对视频不成立**。
  > agent 学了图片那套用到视频上就丢图 —— 所以 `generate.md` 里现在把两条链路**分开写**，
  > 并显式写了「别把图片这条经验搬过去」。
  >
  > 同时加了 `src/main/skillDocsMode.test.ts`（10 条）守住这些句子：删掉它们不会有任何
  > 报错，app 照常构建分发，agent 照常丢图。上游同一 commit 也加了同款守卫，两边各守
  > 各的分发路径。
- **2026-08-19 上游更新到 377 行（画板 ≥ 1.21.26），本机已是 1.21.26。** 三处跟着改了
  `skills/eas-term/generate.md`：
  ① **`generate` 现在返回报价** → 生成流程改成「报价 → 用户在 Eas-Term 里点头 →
     `generate_now`」，不再让用户切回画板。这条对我们价值最大
  ② **删掉「估不出价就换模型」** —— 那条建议是错的，配额耗尽时换哪个模型都一样，
     上游专门写了这个失败模式（agent 一路换到底，其实是钱没了）
  ③ **摸底改用 `get_workspace_overview`** —— 原来写的 `open_project` 会切换用户
     正在看的画布，属于打断用户
- 2026-08-11 晚 上游更新到 322 行：新增「改已配置节点的提示词」（`update_node({prompt})`，
  **1.21.22 起才可用**）、坑位从三条扩到五条（+ `content` 不是提示词、部分模型 prompt 有长度上限）、
  新增 4.5 决策表。要点已同步进 SKILL.md 生图段。
- 2026-08-11 首次接入上游文档。按文档把运行时从「优先系统 node」改成画板自带 Electron；
  新增依赖自检与启动包装器；重写 SKILL.md 生图段（此前缺 confirm 那一步，
  照着做的 agent 会永远轮询一个停在 idle 的节点）。
