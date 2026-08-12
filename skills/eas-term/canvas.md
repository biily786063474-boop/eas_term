# 画布操作

这份文件是画布工具的操作细节 —— 具体场景对应哪个工具、完整参数表、
工具列表里找不到这些工具时该怎么办。SKILL.md 判断出「要操作画布」后来读这份。

---

## 具体场景

**做完一份报告 / 分析页 / 对比表**
→ `canvas_open_html`，接着 `canvas_rename_node` 给它起个能认出来的名字（用户的缩略图上会显示）。
内容多、需要细看的，再 `canvas_maximize_node` 铺满整屏。

**改了前端 / 起了 dev server**
→ `canvas_open_url` 把页面开出来，用户能立刻看到效果，不用自己切浏览器。

**生成了图片 / 图表 / 视频**
→ `canvas_open_file`，媒体文件会开成预览节点。

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
| `secret_check` | `vars[]` | 查密钥在不在，只回布尔 |
| `request_secret` | `name`, `vars[]`, `purpose`, `docs_url?` | 弹 GUI 要密钥，值不经过你 |
| `report_secret_invalid` | `vars[]`, `detail` | 密钥无效，弹窗让用户改 |

不带 `frame_id` 的一律作用于**你自己所在的 Frame**。

---

## 如果工具不见了

`tools/list` 返回空说明没检测到 Eas-Term 环境 —— 你可能跑在 app 外面的终端里（iTerm、系统终端）。
那是正常的，这些工具只在 Eas-Term 自己的终端里生效。
用户如果坚持要用，让他在 Eas-Term 里重开一个终端。
