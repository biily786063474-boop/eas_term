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
list_projects / open_project   挑一个项目（没有就 create_project）
list_models                    拿模型 ID。**别自己编 ID**，只能从这里挑
add_node                       建一个节点，承载这次生成
generate                       写入生成参数 —— 注意：默认**不会真的开始**
   ↓ 必须再走一个出口，二选一（见下）
get_generation_status          轮询到 done（图片 30~60s，视频更久）
```

**`generate` 默认只写参数、节点停在 `idle`，这是画板防止 AI 擅自花用户钱的设计。**
只调 `generate` 就去轮询的话，节点永远是 `idle` —— 这不是坏了，是少走了一步。
两个出口：

| 出口 | 怎么调 | 什么时候用 |
|---|---|---|
| **让用户确认** | `generate(...)` → `confirm_batch_generate()` | 用户正看着画板。画板会弹窗显示参数和墨水成本，他点了才真扣费 |
| **无人值守** | `generate(..., autoConfirm: true)` | 确定没人盯着屏幕时。**会真实扣墨水**，且跳过了唯一一道人工成本确认 |

估不出价时画板会拒绝生成（返回 `estimate_failed`）——那是防资损的闸门，不是 bug。
换个模型，或者退回「让用户确认」那条路。

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
| 本地图片放进画板 | `import_local_file({filePath, type})` | `upload_asset({source:'path'})` 读不了任意路径 |
| 让 A 图当 B 的参考 | `connect_nodes({from, to})` + prompt 里写 `@1` | 连了线但 prompt 不写 `@N` |
| 改已配好的提示词 | `update_node({nodeId, prompt})` | 用 `content` —— 返回 ok 但无效 |
| 看当前配了什么 | `get_node({nodeId})` | 盲改 |
| 真的开始生成 | `autoConfirm:true` 或 `confirm_batch_generate()` | 只调 `generate` 然后干等 |
| 生成失败想重试 | 先 `get_node` 看 prompt，改完再触发 | 对同一节点连着调 `generate` |
| 想先知道用户够不够钱 | `get_user_billing_tier()` | 直接发起然后吃拒绝 |

### 生成完了做什么

**把结果摆到用户眼前**，别只回一句「生成好了」—— 用户在 Eas-Term 里，不一定看着画板。
用前面那些工具（`canvas_open_file` 之类）把产出开成预览节点。

### 分寸

- **别替用户决定花钱**。`autoConfirm: true` 是直接扣费，用之前先问；多轮迭代同理。
- 用户只是问「能不能生成 X」时，先回答能不能，**别直接就开始生成**。
- `list_models` 拿到一次就够，别每次生成前都列一遍。
- 画板刻意没开放 `run_shell_command` / `get_api_keys` / 联网抓取这些能力，
  那是有意为之，别去找绕路。
