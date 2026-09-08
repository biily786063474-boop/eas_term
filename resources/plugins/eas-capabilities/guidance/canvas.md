# 画布操作

这份文件是画布工具的操作细节 —— 具体场景对应哪个工具、完整参数表、
工具列表里找不到这些工具时该怎么办。SKILL.md 判断出「要操作画布」后来读这份。

> **术语**：下面所有的 **Frame**，就是用户口中的「**造梦空间**」/「**项目区**」——
> 一个 Frame 绑一个项目，装着它的终端、AI 对话、文件预览。
> 用户那么说的时候指的就是它；工具参数仍然叫 `frame_id`。

---

## 铁规矩：内容一律进 Frame，画布上最多 5 个

**HTML、Markdown、代码、图片、视频、网页 —— 所有这类「内容模块」都开在 Frame 里面**，
不要撒在 Frame 外的空白画布上。工具默认就是这个行为：不带 `frame_id` 时开在你自己所在的
Frame，你不用做额外的事，**但也别想办法绕开它**。

**一个 Frame 最多同时摆 5 个内容模块。**开第 6 个的时候，**最早的那个会被自动关掉**，
腾出位置给新的。这是有意的 —— 用户要的是一块能看清的画布，不是一屏叠着几十个窗口的垃圾场。

被这条约束的只有内容模块。**终端和 AI 对话不算数、也永远不会被自动清理** —— 它们是活的东西。
用户自己摆的画布组件（便签、待办这些）同样不算数。

**用户可以把某个模块「钉在画板上」**（模块右上角的图钉按钮）。钉住的模块：

- 不占那 5 个名额
- 永远不会被自动清理，只能用户自己关

所以用户说「这个别给我清掉」，答案是**让他点右上角的图钉**，不是让你去改配置。

对你的实际影响：

- **别刷屏**。一次任务开一两个预览就够。开到第 6 个，你自己前面开的那个就没了。
- 一份内容分几步做完的，**改内容后重新 `canvas_open_html` 同一个路径就行**，
  不要每一版都新开一个节点 —— 五版下来最早的几版连同用户在看的东西一起被挤掉。
- 临时预览用完了主动 `canvas_close_node`，别指望自动清理替你收尾：
  自动清理踢掉的是**最早的**那个，很可能正是用户还在看的那个。
- 你**不能**替用户钉模块，也没有工具能改这个上限。这是用户的画布，边界由他定。

---

## 具体场景

**做完一份报告 / 分析页 / 对比表**
→ `canvas_open_html`，接着 `canvas_rename_node` 给它起个能认出来的名字（用户的缩略图上会显示）。
内容多、需要细看的，再 `canvas_maximize_node` 铺满整屏。

**改了前端 / 起了 dev server**
→ `canvas_open_url` 把页面开出来，用户能立刻看到效果，不用自己切浏览器。

**生成了图片 / 图表 / 视频**
→ 本地 PNG/JPEG/GIF/WebP/BMP/ICO/AVIF 优先用 `canvas_open_image`，添加到当前会话所属 Frame；名额满时自动关闭最早的未固定内容预览，不删除源文件。SVG、视频等仍用 `canvas_open_file`，后者可能需要审批。

**长任务跑完（构建、测试、批处理）**
→ `notify`。用户很可能已经切到别的项目去了，铃铛能把他叫回来。

**开了一堆预览之后**
→ `canvas_tidy_frame` 收拾干净，别留一屏重叠的窗口给用户。
自己开的临时预览用完了就 `canvas_close_node` 关掉。

**需要用户做决定 / 有待办**
→ `canvas_add_note` 贴张便签写清楚。对话会滚走，便签留在画布上。

**缺 API key / token 跑不下去**
→ 见 `secrets.md`。**一句话：别说「你去申请一个然后贴给我」。**

---

## 完整工具表

| 工具 | 参数 | 干什么 |
|---|---|---|
| `canvas_open_html` | `path` | 本地 HTML → 浏览器节点 |
| `canvas_open_image` | `path` | 本地光栅图片 → 当前会话 Frame；名额满自动关闭最早的未固定内容预览；不接受 SVG/HTML/视频/网址 |
| `canvas_open_file` | `path` | 文件预览（代码/Markdown 走代码视图，图片视频走媒体视图） |
| `canvas_open_url` | `url` | 开网址 |
| `notify` | `message` | 点亮标题栏铃铛 + 项目徽标 |
| `canvas_get_state` | — | 读完整画布状态，拿 node_id |
| `canvas_list_frames` | — | 只列 Frame（轻量） |
| `canvas_focus_node` | `node_id` | 视口移过去并选中 |
| `canvas_maximize_node` | `node_id` 或 `restore:true` | 最大化沉浸 / 还原 |
| `canvas_close_node` | `node_id` | 关模块（终端除外） |
| `canvas_rename_node` | `node_id`, `name` | 改名（缩略图上能认出来） |
| `canvas_tidy_frame` | `frame_id?` | 按大小从左上角流式重排 |
| `canvas_new_terminal` | `frame_id?` | 开个空终端给用户 |
| `canvas_add_note` | `text`, `color?` | 贴便签到 Frame 右侧 |
| `secret_check` | `vars[]`（可空）| 查密钥在不在，只回布尔；**留空 = 列出柜里有什么**（名字/备注/变量名，不含值）|
| `request_secret` | `name`, `vars[]`, `purpose`, `docs_url?` | 弹 GUI 要密钥，值不经过你 |
| `report_secret_invalid` | `vars[]`, `detail` | 密钥无效，弹窗让用户改 |

不带 `frame_id` 的一律作用于**你自己所在的 Frame**。

旧通用预览工具（`canvas_open_html` / `canvas_open_file` / `canvas_open_url`）开出来的都是**内容模块**，
受上面那条「一个 Frame 最多 5 个、超了自动清理最早的」约束。

---

## 如果工具不见了

`tools/list` 返回空说明没检测到 Eas-Term 环境 —— 你可能跑在 app 外面的终端里（iTerm、系统终端）。
那是正常的，这些工具只在 Eas-Term 自己的终端里生效。
用户如果坚持要用，让他在 Eas-Term 里重开一个终端。

`canvas_open_image` 与其他预览统一：先校验图片，新增时同步关闭最早的未固定内容预览。固定内容不占名额；终端、AI 对话、组件和其他 Frame 不参与清理。不删除源文件，返回 evicted_node_ids 供核对。
