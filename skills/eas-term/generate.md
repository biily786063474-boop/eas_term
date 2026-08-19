# 生成图片 / 视频

这份文件是「要出图 / 出视频」的具体操作步骤 —— 完整生成顺序、改已配置节点、
六个常见坑、意图到工具的对照表。SKILL.md 判断出用户要生成媒体后来读这份。

---

## 要出图 / 出视频时

**这台机器上的生成走「笔纵画板」，不要去调别的图像 API，也不要自己写生成脚本。**

画板是另一个 app，它自带一个 MCP，名字叫 `bizone-canvas`。用户装了画板的话，
它的工具已经自动配好在你的工具列表里 —— 调一次 `list_models` 就知道在不在。

| 情况 | 怎么办 |
|---|---|
| 工具列表里**没有** `bizone-canvas` 的工具 | 用户没装画板，或画板版本 < 1.21.20（更早的安装包里没带 MCP 依赖，一律连不上）。告诉他去 bzone.biily.top 装 / 更新，别自己找别的生图路子 |
| 调用报 `-32000 Connection closed` | 同上，多半是画板太旧；也可能是画板被改名或移出了 `/Applications` |
| 调用报连不上画板 | 画板没在跑。Eas-Term 配的通道会自动在后台把画板拉起来，等几秒重试一次；还不行就让用户手动打开 |
| 报额度 / 余额相关的错 | 如实转达，让用户去画板里处理。不要试图绕过 |

### 一次生成的完整顺序

生成是**在画板的某个节点上触发**的，不是凭空出图 —— 所以要先有项目和节点：

```
get_workspace_overview         看有哪些项目、里面有什么节点（没有项目就 create_project）
list_models                    拿模型 ID。**别自己编 ID**，只能从这里挑
add_node                       建一个节点，承载这次生成
generate                       写入参数 + **返回这次的报价**，不扣费
   ↓ 把价格报给用户，等他点头
generate_now                   真正开始，这一步才扣费
get_generation_status          轮询到 done（图片 30~60s，视频更久）
```

**第一步别用 `open_project` 挨个切着看** —— 它会改变用户当前正在看的画布。
`get_workspace_overview` 是只读的，一次给全项目和节点，任何时候都能调。

### 报价 → 确认 → 生成（默认走这条）

`generate` 默认只写参数、节点停在 `idle`，这是画板防止 AI 擅自花用户钱的设计。
**但它会把价格一起返回**，所以报价和确认都在你这边完成，不用把用户赶回画板：

```
① generate(nodeId, modelId, prompt)  → 返回 estimate.credits，不扣费
② 你说：模型 X / 提示词大意 / 预计 686 墨水
③ 用户说「确认」
④ generate_now(nodeId)               → 开始，扣费
```

`estimate.credits` 用的是**和真实扣费同一个估价函数**，报多少扣多少（上游实测 686 → 686）。
多个节点就逐个 `generate_now`。

> **报价要画板 ≥ 1.21.26。** 更旧的版本 `generate` 返回里没有 `estimate` 这个字段 ——
> 那时别干等，退回下面「用户要在画板里核对」那条路，并提一句更新画板能在这里直接看到价格。

**`estimate` 有三种结果，含义完全不同 —— 中间那种最容易误判：**

| 返回 | 意思 | 你该怎么做 |
|---|---|---|
| `estimate.credits` 是数字 | 能报价 | 报给用户，等确认后 `generate_now` |
| `credits: null` + 带 `note` | **按用量计费，仍然可以生成** | 照实说「这个模型按实际用量计费，事先报不了价」，**别去换模型** |
| `estimate_error` 有值 | 真估不出来，`generate_now` 会拒绝 | 看它说的原因。**若是套餐过期 / 没墨水了，引导用户续费充值 —— 换模型没有用** |

> 中间那条是上游专门写出来的教训：早期版本把「配额耗尽」也归进这一类，
> 结果 agent 一路换模型换到底，其实是钱没了。现在真失败一定带 `estimate_error`。

另外两条路，各有明确的适用场景：

| 出口 | 怎么调 | 什么时候用 |
|---|---|---|
| **用户要在画板里核对** | `generate(...)` → `confirm_batch_generate()` | 他正看着画板、想在那边确认参数。**没人看着画板时别用** —— 没人去点，任务就卡死 |
| **无人值守** | `generate(..., autoConfirm: true)` | 确定没人在场。⚠️ **会真实扣费，且用户从头到尾看不到价格** |

有人在场就走上面的报价路径，让他先看到数字。

### 改已经配好的节点

想换个提示词重出，**不用重走整个流程**：

```
get_node(nodeId)        先看当前配的是什么：prompt / modelId / genParams
update_node(nodeId, prompt: '改后的提示词，可以继续用 @1')
```

`genParams.awaitingConfirm === true` = **已配置但还没触发生成**（节点停在 idle），
这时候要么 `confirm_batch_generate`，要么 `generate(autoConfirm: true)`。

对同一节点再调一次 `generate` 也行（覆盖旧参数），两种方式都不会重复扣费。
回执里那句「不要为了重试连续调用」说的是别拿它当重试机制，不是禁止改参数。

### 六个会坑人的点

1. **上游连了媒体，prompt 里必须写 `@N` 指名**。≥2 个媒体上游而 prompt 里没有 `@N`
   会被**硬拦**（多图不指名模型会瞎猜）。`generate` 的回执里有 `media_ref_map`，
   照它对一遍 `@1` 到底是哪张图。**不要以为「上游连着就会自动当上下文」**。
2. **`connect_nodes` 的参数名是 `from` / `to`**，不是 `sourceId`/`targetId`。写错会报
   `Cannot self-connect`（两个 `undefined` 被当成同一个节点）—— 报错方向完全是误导。
3. **改提示词用 `prompt` 字段，不是 `content`**。`update_node({content})` 会返回成功，
   但 `generate` 根本不读它 —— 改了等于没改，而且没有任何报错。
   ⚠️ **画板 1.21.21 及以前这条路整个不通**：传 `prompt` 会被静默丢弃、`get_node`
   也读不到当前提示词。症状是「改提示词总是失败」且毫无线索。**1.21.22 起才修好** ——
   撞上了先让用户更新画板，别在那儿反复试。
4. **prompt 用中文写**。不是硬拦截，但回执会带 `prompt_lang_warn`；而且用户在画板界面上
   要看得懂、能直接改。
5. **模型 ID 只能来自 `list_models`，不要凭记忆写。**
6. **有些模型对 prompt 有长度上限**（例如 MiniMax H3 是 7000 字符）。超了会被提前拦下，
   并告诉你要删多少字。

### 意图 → 该调什么

上游文档里那张决策表，照抄要点（左边是你想干的事，右边是**常见的错法**）：

| 想干什么 | 调什么 | 别这么干 |
|---|---|---|
| **先摸清画板里有什么** | `get_workspace_overview()` —— 只读，一次拿全 | `open_project` 挨个切 —— **会改变用户正在看的画布** |
| 本地图片放进画板 | `import_local_file({filePath, type})` | `upload_asset({source:'path'})` 读不了任意路径 |
| 让 A 图当 B 的参考 | `connect_nodes({from, to})` + prompt 里写 `@1` | 连了线但 prompt 不写 `@N` |
| 改已配好的提示词 | `update_node({nodeId, prompt})` | 用 `content` —— 返回 ok 但无效 |
| 看当前配了什么 | `get_node({nodeId})` | 盲改 |
| **报价给用户** | `generate(...)` 读返回的 `estimate.credits` | 自己按模型猜价，或让用户去画板看 |
| **真的开始生成（默认）** | 报价 → 用户点头 → `generate_now({nodeId})` | 只调 `generate` 然后干等 —— 节点永远 `idle` |
| 真的开始生成（无人值守） | `generate({..., autoConfirm:true})` | 有人在场时用它 —— 用户看不到价格 |
| 真的开始生成（用户要在画板核对） | `generate(...)` → `confirm_batch_generate()` | 没人看着画板时用它 —— 没人去点，任务卡死 |
| **被拒说估不出价** | 看 `estimate_error`：套餐过期/没墨水就引导续费 | **换模型重试 —— 换哪个都一样** |
| 生成失败想重试 | 先 `get_node` 看 prompt，改完再触发 | 对同一节点连着调 `generate` |
| 想先知道用户够不够钱 | `get_user_billing_tier()` | 直接发起然后吃拒绝 |

### 生成完了做什么

**把结果摆到用户眼前**，别只回一句「生成好了」—— 用户在 Eas-Term 里，不一定看着画板。
用 `canvas.md` 里的那些工具（`canvas_open_file` 之类）把产出开成预览节点。

### 分寸

- **别替用户决定花钱。** 现在有报价路径了 —— `generate` 拿到 `estimate.credits`，
  **把数字告诉他、等他点头再 `generate_now`**。`autoConfirm: true` 跳过的正是这一步，
  只在确定没人在场时用。多轮迭代同理，每一轮都是一次扣费。
- 用户只是问「能不能生成 X」时，先回答能不能，**别直接就开始生成**。
- `list_models` 拿到一次就够，别每次生成前都列一遍。
- 画板刻意没开放 `run_shell_command` / `get_api_keys` / 联网抓取这些能力，
  那是有意为之，别去找绕路。
