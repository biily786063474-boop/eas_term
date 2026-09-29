# Opus 作品画廊插件 · 设计

日期：2026-09-28 · 分支：`feat/opus-gallery-20260928`（从 `origin/main` 764499ab 起）

## 目标

在画布上可视化浏览 [awesome-opus5-5-videos](https://github.com/yihui-dev/awesome-opus5-5-videos)
收录的 389 件 Opus 5.5 代码动画作品，点选一件后，把「以它为风格参考、内容换成我的主题」的
指令注入当前对话，让 AI 做出同调性的单文件 HTML 动画。

## 分期（已定：先 A 后 B）

| | 本期（A · 个人版） | 以后（B · 正式功能） |
|---|---|---|
| 插件位置 | `~/.eas/plugins/opus-gallery/`，**不进安装包** | 进 `resources/plugins/` |
| 素材 | 直连原站，本机缓存 | 迁到自有 CDN；**只存提示词 + 署名 + 原帖链接**，预览不转存（跳原帖或用自己的复刻录屏） |
| 出站清单 / 隐私页 | 不涉及（个人插件，不是产品出站） | 必须登记、同 commit 改 `site/privacy.html` |

版权依据：仓库 MIT 只覆盖列表与数据文件，视频与提示词归原作者（其 Credits 节）。
个人收藏使用没问题；随产品分发给用户就是转载，B 期必须按上表改造。

本期唯一进产品代码的是宿主的 **`ui/message` 通道**——通用能力，与素材无关。

## 一、插件本体

目录 `~/.eas/plugins/opus-gallery/`，照 `resources/plugins/timeline/` 三件套。

### plugin.json

一个面板（`defaultSize` 约 800×720），`permissions.canvas: []`，不订阅事件。

### server.mjs · 数据与缓存

- 数据源：`https://raw.githubusercontent.com/yihui-dev/awesome-opus5-5-videos/main/data/videos.json`
  （2026-09-28 实测 465KB、389 条；字段 `slug / author / author_url / category / post_url /
  poster_url / skillry_url / prompt / prompt_partial / tech_tags / added`）。
- 预览动图 URL 由 slug 拼：`https://media.skillry.dev/opus-5-5/<slug>/preview.webp`。
  实测封面均 ~23KB、预览均 ~60KB，全量 ~33MB。
- 缓存放插件目录 `cache/`：`videos.json` + `etag`、`poster/<slug>.webp`、`preview/<slug>.webp`。
  - 打开面板时带 `If-None-Match` 条件请求；304 不重拉，有新增只下新的。
  - 图片**懒下载**：面板要哪页才拉哪页的封面；预览只在悬停时拉。
  - 下载并发上限 4，单个超时 15s；失败的留空，下次再试，不整体报错。
- 面板 CSP 是 `img-src data: blob:; connect-src 'none'`（`src/main/panelHtml.ts:13`，有测试锁），
  所以图片一律由 server 读缓存转 data URL 经工具返回，**分页**（每页 ≤ 36 张）。
- 离线/上游失败 → 用旧缓存，结果里带 `offline: true` 与条数，面板顶部说人话提示。
  首次就失败且无缓存 → 面板显示原因 + 「重试」按钮，不显示空网格装没事。

工具（面板经 `tools/call` 调）：

| 工具 | 入参 | 出参 |
|---|---|---|
| `gallery_list` | `category?`、`tag?`、`page` | 条目元数据 + 封面 data URL、总页数、`offline` |
| `gallery_preview` | `slug` | 预览动图 data URL（没有则回封面） |
| `gallery_compose` | `slug`、`topic`、`presetId?` | 拼好的注入文本（见第三节） |
| `gallery_presets` / `gallery_preset_save` / `gallery_preset_delete` | — | 附加约束预设的增删查，存 `presets.json` |

### ui/panel.html

- 顶部：四个分类页签（动态图形 / 讲解 / 3D / 游戏，映射 `category`）+ 技术标签下拉。
- 中间：封面网格；悬停换成预览动图；点选展开右侧详情：原提示词（`prompt_partial` 为真时标「仅部分公开」）、
  作者、技术标签、「看原帖」（走已有的 `ui/open-link`）。
- 底部注入区：主题输入框 + 「附加约束」下拉（可新建/编辑，首次内置一套「Eas-Term 宣传片规范」预设，
  取自记忆里的宣传片风格规范）+ 「用它做」按钮。
- 「用它做」= `gallery_compose` 拿文本 → `ui/message` 注入。主题为空时按钮置灰。
- 注入结果如实回显：成功「已挂到对话框」；失败显示宿主给的原因（如「先点一下要注入的对话框」）。

## 二、宿主 · 补 `ui/message`（产品代码）

现状：`src/shared/pluginProtocol.ts:19` 声明了 `ui/message`，
`src/main/pluginHost.ts` 面板调度走 `default` 回 -32601。

改动：

1. `pluginHost.ts` 面板调度加 `case 'ui/message'`：
   - 参数 `{ label: string, text: string }`；`text` 非空且 ≤ 20000 字，`label` ≤ 40 字，否则 `JSONRPC_INVALID_PARAMS`。
   - 经 IPC 发给渲染层，**等渲染层回执**再回面板（不假装成功）。
2. 渲染层接收（与辞典同一条 chip 通道 `composerAddChip`，见 `DictView.insert`、`agentChat/chips.ts`）：
   - 有已登记的对话输入框 → 挂 chip，标签由宿主加前缀 `插件名 · label`，chip id 用 `plugin:<插件名>:<hash>` 去重；
     **不自动发送**，用户可补话后再发；发送那一刻展开全文（chips.ts 既有行为）。
   - 没有输入框 → 回失败「没有可注入的对话框，先点一下要注入的对话框」。**不降级写终端**：
     几百字的指令直接灌进 CLI 输入行会被当场提交，不可撤。
3. 同 commit 更新图纸：`10-模块领地图`、`11-MCP工具网络`、`13-所有权矩阵` 中插件协议相关处。

注意：`feat/composer-assist-20260928` 分支也在动对话输入框，合并前跑 `merge_preflight` 看冲突。

## 三、注入模板

放在 `server.mjs`，便于以后调：

```
参考下面这件 Opus 5.5 作品的调性、节奏、镜头语言和技术栈（{tech_tags}），
为「{topic}」做一个单文件 HTML 动画：纯内联、零外部依赖、断网可开、适合直接录屏。
不要照搬原作的内容主题，只借它的风格。

原作：@{author}（{post_url}）
原提示词{（仅部分公开）}：
{prompt}

{附加约束：
{preset.text}}
```

chip 标签：`Opus 风格 · @{author}`。

## 测试与验证

- 宿主 `ui/message`：TDD 单测覆盖参数校验、无输入框的失败回执、成功时 chip 调用参数、未知插件拒绝。
- `server.mjs`：用本地假上游测 304 走缓存、增量下载、离线回退、分页边界、模板拼装（有/无预设、`prompt_partial`）。
- 真机验证（open-app-verify）：装进本机 → 打开面板 → 浏览/筛选 → 悬停预览 → 点选 → 注入 → 发送，截图；
  另测「从没点过对话框」「断网」两条失败路径。没亲眼看到的部分如实标「未验证」。

## 不做（YAGNI）

多选混搭、收藏夹、自有 CDN 同步脚本、搜索全文、把生成结果回挂到作品旁对比——都等 A 期用顺了再说。
