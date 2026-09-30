# 发布台插件（publish-desk）设计 · P0

- 日期：2026-09-29 · 分支 `feat/publish-desk-20260929`（基于 origin/main 02be79ad）
- 用户原话：「给我做一个插件，把内容分批次放到插件中的不同位置，在插件里可以去打开对应的网页，记录登录状态，人为手动点发布。除了海外社媒还要有小红书、抖音、视频号，知乎、哔哩哔哩等。收集各平台违禁词做成插件独有的知识库，做违禁词检测。发布前把内容放进统一的管理面板，每个社媒对应一篇内容加上它的网页，用户可以一键复制或上传，或者用 computer use 一键配置和上传。」→ 方案经用户同意（「OK我同意」），本文件是 P0 设计，**拍板后再写代码**。

---

## 一、能力边界（按 origin/main 实查，决定了方案形状）

| 想要的 | 现状 | 结论 |
|---|---|---|
| 插件有自己的面板 | 插件可带 `ui://` 面板（沙箱 iframe，`sandbox="allow-scripts"`，CSP `connect-src 'none'`）；挂画布节点 / 抽屉 / 对话 | ✅ 直接用 |
| 面板打开平台网页 | `ui/open-link`（仅 http/s）→ `canvas_open_url` 开画布网页节点 | ✅ 直接用 |
| 记住登录 | 画布网页节点共用 `partition='persist:browser'`，重启保留 cookie | ✅；⚠️ **同一站点只能登一个账号**（多账号要改分区，另立项） |
| 一键复制 | 面板在沙箱里拿不到 `window.api.clipboard`；协议里没有剪贴板方法 | 🟡 **要加一个面板私有方法**（见四） |
| 插件往网页里填字 / 上传文件 | 全仓没有给网页节点用的注入接口；`page_live_*` 只放行 localhost 且不保留登录，且只给 AI 会话 | ❌ 不做（这是安全设计） |
| computer use 自动填 | 电脑视野插件**拒绝操作 Eas-Term 自己的窗口**（`lib/guard.ts`），仅 macOS，每次授权 5/10/30 分钟 | ❌ 在 app 内不可能；🟡 P4 可选：在**外部浏览器**里填，停在发布键前 |
| AI 往插件里存稿 | 插件 MCP 工具可被启用了插件的 AI 会话调用 | ✅ |
| 插件存数据 | 全局 `EAS_PLUGIN_DATA=userData/plugin-data/<名>/`；按项目照 execution-plan：宿主 `guardDir` + 插件自校验两道 | ✅ |
| 复用 wiki 知识库 | wiki_* 只有 AI 会话能调，插件进程拿不到 `EAS_TERM_TOKEN`（红线，不许注入） | 违禁词库做成**插件自己的数据**，不复用 wiki |

红线（照做）：不新增出站（插件不联网：词库本地、检测本地）；不扩大 `CANVAS_CALL_ALLOWLIST`；面板私有方法三处同改（`shared/pluginProtocol.ts` 白名单 ↔ `appsProtocol.ts` ↔ `pluginHost.ts`）；项目数据写入两道路径校验；**始终由用户本人点「发布」**。

## 二、流程

1. **写稿**：用户在对话里说「这条发这几个平台」→ AI 按各平台规则写每平台一版 → 调插件工具 `desk_add_draft` 存进当前项目的发布批次。
2. **两道闸门（顺序不能反，照自媒体流水线规矩）**：先事实核查（AI 在对话里做，结论写进卡片 `factCheck`）→ 再违禁词：插件本地词库扫一遍（命中词、位置、条款依据、建议写法）→ AI 语义复查（换了说法的绝对化用语）。
3. **发布台**：面板一张表，每个平台一张卡：标题 / 正文 / 标签 / 素材清单 / 规则检查（字数、标签数、比例）/ 违禁词结果 / 状态。
4. **逐个手动发**：「打开发布页」→ 画布网页节点（沿用登录）→「复制标题」「复制正文」「复制标签」粘贴 →「在访达中显示素材」拖进上传框 → **用户点发布** → 贴回发布链接，状态变「已发」。
5. **复盘接口**：已发的卡保留链接和时间，留给自媒体流水线的复盘。

## 三、数据模型

按项目存 `<项目>/.eas/publish-desk.json`（宿主 guardDir + 插件自校验，照 execution-plan `lib/store.mjs`）：

```ts
type Batch = { id: string; title: string; createdAt: string; source?: string /* 成片或素材路径 */; cards: Card[] }
type Card = {
  platform: PlatformId            // 'x' | 'reddit' | 'bluesky' | 'threads' | 'linkedin' | 'youtube' | 'youtube-shorts'
                                  // | 'indiehackers' | 'producthunt' | 'xiaohongshu' | 'douyin' | 'channels' | 'zhihu' | 'bilibili'
  title?: string; body: string; tags: string[]; media: { path: string; role: 'video' | 'cover' | 'image' }[]
  extra?: Record<string, string>  // 平台特有字段：Reddit 版块、PH 标语、知乎想法/文章/视频…
  factCheck?: { status: 'pending' | 'pass' | 'fixed'; note: string }
  lint?: LintResult               // 最近一次检测结果（字数、违禁词）
  status: 'draft' | 'ready' | 'published' | 'skipped'; publishedUrl?: string; publishedAt?: string
}
```

全局（`EAS_PLUGIN_DATA`）：`platforms.json`（平台规则，见六）、`lexicon/*.json`（违禁词库，见五）、`lexicon/user.json`（用户自己积累的词）。

## 四、插件形状（照 execution-plan 样板，`resources/plugins/publish-desk/`）

> **P1 实现与本节原稿的三处偏差（2026-09-29，已按实现为准）：**
> 1. **存储改为插件全局** `EAS_PLUGIN_DATA/publish-desk.json`，不按项目存 `.eas/publish-desk.json`。原因：通用插件的模型侧调用拿不到项目 cwd（宿主只给时间线、执行清单特判），为发布台再加一处特判不值；发布批次本来就跨项目。写法仍照执行清单：排队 + 锁文件 + 锁内重读 + fsync 后 rename，符号链接拒绝，坏库不覆盖。
> 2. **没有面板私有 `panel/list|update|lint`**：通用插件面板的 `panel/*` 不会转发给插件，面板与 AI 共用 `desk_*` 工具（走 `tools/call`）。实际工具：`desk_platforms`、`desk_add_batch`、`desk_update_card`、`desk_list`、`desk_mark`、`desk_archive`；字数检查随 `desk_list` 返回，违禁词检测留 P2。
> 3. `permissions.canvas` 为空：打开发布页用宿主现成的 `ui/open-link`（→ `canvas_open_url`），不需要声明画布权限。
> 宿主两个动作 `panel/clipboard.write` / `panel/reveal` 按原稿做了：渲染层闸门（本地插件 + 焦点在面板 + 真实点击）＋ 主进程内容判定（≤64KB 纯文本；reveal 过 guardPath 且必须是文件）。`navigator.clipboard` 备选未采用。

- `plugin.json`：`mcp: node ./server.mjs`；面板 `ui://publish-desk/panel`；`permissions.canvas: ['canvas_open_url']`。
- MCP 工具（给 AI 用）：`desk_list_platforms`（含规则与可信度）、`desk_add_draft` / `desk_update_draft`、`desk_lint`（本地检测，返回命中与依据）、`desk_list_batches`、`desk_mark`（状态/链接）。
- 面板私有方法（只有面板能调）：`panel/list`、`panel/update`、`panel/lint`。
- **宿主新增一个剪贴板私有方法** `panel/clipboard.write`：宿主侧用 Electron `clipboard.writeText`，**只收纯文本、限长 64KB、只在用户点击触发**（面板请求带用户手势标记，宿主拒绝无手势的连续写入）。三处同改 + 测试。
  备选（P1 先试）：面板里直接 `navigator.clipboard.writeText` —— 沙箱 iframe 下大概率被拒，实测后再定。
- 「在访达中显示素材」：面板私有方法 `panel/reveal`，宿主 `shell.showItemInFolder`，路径必须在当前项目根内（guardPath）。
- **不做**：网页注入、自动上传、自动点发布、插件联网。

## 五、违禁词知识库

调研结论：**没有任何官方违禁词表**。《广告法》第九条第（三）项禁止「国家级、最高级、最佳」等用语，市场监管总局 2023 年第 6 号公告《广告绝对化用语执法指南》要求结合语境判断、列出不算违法的情形（经营理念、自我比较、时空顺序、如实销量等），并批评「一刀切」；各平台社区规范只有原则条款、没有词表；网传「违禁词大全」非官方、来源不明，照搬有著作权与误报风险。

所以词库这样建，**每条必须带依据，命中写成「提示」不写「禁止」**：

```ts
type Term = { word: string; kind: 'absolute' | 'medical' | 'finance' | 'traffic' | 'platform' | 'user'
  platforms: PlatformId[] | 'all'; basis: string /* 法条或规范原文出处 */; confidence: 'law' | 'guideline' | 'observed'
  hint: string /* 为什么要注意 + 建议写法 */; context?: string /* 什么语境下可以用（如「有据可查的销量第一」）*/ }
```

- `law`：广告法第九条及执法指南（附条款号）；`guideline`：平台社区规范条款（附链接）；`observed`：用户自己被限流 / 删帖时记下的（附日期和平台）。
- 首版只收 `law` 一类（有法条可依），平台规范类按条款人工整理，**不导入网传词表**。
- 检测：本地正则 + 分词，结果给命中词、位置、依据、建议；再由 AI 在对话里做语义复查（插件不调模型、不联网）。

> **P2 已实现（2026-09-30）**：原文逐条核实见 `docs/knowledge/publish-desk-lexicon-basis-2026-09-30.md`。
> - 法律类 6 条：广告法第九条（三）绝对化用语（含「最 + 评价词」「第一 / 唯一 / 首个」、近义成语）、第二十四条教育培训与第二十五条投资回报的保证性承诺。执法指南第五、六条的不适用情形写进每条的「可以用的情形」，常见非推销用法（第一次、最近、最大化、最好先…、最低配置、唯一的缺点）做了语境排除并有测试。
> - 平台类 12 条：小红书 3.2.1 / 3.2.2（联系方式、网址二维码水印、引导去他平台）、抖音第 34 / 35 条、B站「违规推广」、知乎（仅机构号规范，低级提醒）。
> - **没有原文、故意不做**：视频号对一般内容无「禁止留联系方式」条款；知乎《社区管理规定》原文取不到；小红书推广笔记规范 / 蒲公英报备未取到；「提到外部品牌名本身」在各平台原文里都没有禁止，只有「引导去他平台」和「商业推广未声明」——后者靠词匹配判断不了，未做。海外平台只禁刷屏不禁词，未设词条。
> - 工具：`desk_check`（检任意文本）、`desk_lexicon`（list / add / remove，用户词条要日期与平台）；卡片 `hits` 随 `desk_list` 返回，面板高亮并显示依据、建议、「看原文」。

> **P3 已实现（2026-09-30）**：素材规格原文见 `docs/knowledge/publish-desk-media-specs-2026-09-30.md`。本地读素材（纯 JS，不依赖 ffprobe）→ 对照平台规格 → 卡片显示每个素材的比例 / 分辨率 / 时长 / 大小与提示，并列出平台要准备的素材与封面尺寸。海外 8 个平台的主要数值有官方原文；小红书、抖音、视频号、知乎、B站（除网页端 8GB）只有第三方或搜索摘要，按参考值只提醒。真实成片验证：`Film9V-EN.mp4`（3:4、2分56秒、144MB）在 X 免费账号超时长上限（140 秒），其余平台比例都在范围内，≤3 分钟竖版会归为 YouTube Shorts。

## 六、平台规则（2026-09-29 调研；✓ = 官方帮助页有原文，参考 = 第三方或未核实，卡片上显示「以上传页提示为准」）

| 平台 | 发布入口 | 已核实规则 |
|---|---|---|
| X | x.com/compose/post | 免费账号 280 字符 ✓；视频非 Premium ≤140 秒、≤512MB ✓（取自官方页摘要） |
| Reddit | reddit.com/submit | 标题 300 / 正文 40000（参考）；各版块可关视频或画廊 |
| Bluesky | bsky.app | 300 字（参考）；视频 ≤10 分钟、≤300MB（2026-08，参考） |
| Threads | threads.com | 500 字符 ✓；视频 ≤5 分钟 ≤1GB，比例 0.01:1–10:1（3:4、9:16 可）✓（API 文档） |
| LinkedIn | linkedin.com/feed → Start a post | 3000 字符 ✓；视频 3 秒–15 分钟，比例 1:2.4–2.4:1 ✓ |
| YouTube | studio.youtube.com | 标题 100 / 描述 5000 ✓；标签超 60 个全忽略 ✓；自定义封面需验证账号 ✓ |
| YouTube Shorts | 同上 | ≤3 分钟、方形或竖屏（含 3:4）自动归为 Shorts ✓ |
| Product Hunt | 右上角 Submit | 标语 60 字符 ✓；标签 ≤3 ✓；描述官方两处写法冲突（500 / 260） |
| Indie Hackers | indiehackers.com/new-post | 无官方规格 |
| 小红书 | creator.xiaohongshu.com/publish/publish | 标题 20 / 正文 1000（参考）；图片张数、视频上限说法不一 |
| 抖音 | creator.douyin.com | 视频上限说法不一（参考） |
| 视频号 | channels.weixin.qq.com | 比例 0.33–3（含 3:4）、≤2GB、电脑端 3 秒–8 小时、图 ≤20（官方页摘要）；**只能微信扫码，有用户反映要天天重扫** |
| 知乎 | zhuanlan.zhihu.com/write 等 | 视频标题 30 / 简介 300（参考） |
| 哔哩哔哩 | member.bilibili.com/platform/upload | 网页端 8G（参考）；标题 80、标签 10（参考） |

规则存 `platforms.json`，每条带 `source` 与 `verified`，改规则不用改代码。完整来源清单见 `docs/knowledge/publish-desk-platform-research-2026-09-29.md`。

## 七、分阶段与验收

| 阶段 | 做什么 | 验收（照 plugin-integration-baseline 顺序：单测 → 真实包 stdio → 隔离应用 → 安装/调用/撤销） |
|---|---|---|
| **P1 最小可用** | 插件骨架、按项目存储、AI 存稿工具、发布台面板、打开发布页、剪贴板私有方法、在访达中显示、手动标记已发 | store 路径越界 / 符号链接拒绝测试；剪贴板方法无手势拒绝、超长拒绝测试；隔离实例里 AI 存稿 → 面板出现 → 复制粘进网页节点 → 标记已发，截图为证 |
| P2 违禁词与规则 | 词库（先 law 类）、本地检测、平台规则检查（字数 / 标签数 / 比例），AI 语义复查提示 | 词库每条有依据的校验测试；《执法指南》列出的「不算违法」情形不误报的用例 |
| P3 素材辅助 | 各平台素材清单、比例提示（3:4 / 9:16 / 16:9）、封面尺寸提示 | 真实成片走一遍 |
| P4（可选） | 电脑视野在**外部浏览器**里代填，停在发布键前 | 用 P1–P3 一段时间后再决定；仅 macOS |

## 八、已拍板（2026-09-29，用户逐条确认）

1. **首批平台**：14 个全部建卡；P1 完整跑通验收 X、小红书、B 站（海外一个、国内图文一个、国内长视频一个），其余只有卡片 + 打开发布页。
2. **剪贴板**：同意在宿主加 `panel/clipboard.write`（纯文本、≤64KB、需点击触发），三处同改 + 测试。
3. **违禁词首版**：先按法律依据（广告法第九条绝对化用语 + 执法指南的例外说明）；用户追加：**私域引流（微信号 / 手机号 / 谐音变体 / 二维码提示）、外部品牌名（他平台名、竞品）、链接（网址 / 短链 / 「主页链接」引导）等平台级规则也要加**——按平台区分尺度，多为规则匹配而非词表，每条挂该平台社区规范原文与链接，P2 实现时逐条对照原文核实；不导入网传词表；预留 `user` 类（被限流 / 删帖时记下，标日期与平台）。
4. **多账号**：接受同一平台只登一个号，多账号另立项。
