---
name: eas-term
description: >
  你正跑在「Eas-Term」这个桌面工作台的终端里 —— 它左边是终端、右边是一块无限画布，
  用户在画布上摆着终端、网页预览、代码预览、设计模块等模块，按项目分组成 Frame。
  你可以直接操控这块画布：把产出的 HTML/图片/代码开成预览节点摆到用户眼前、打开网址、
  最大化让用户细看、整理布局、贴便签、发完成通知。
  Triggers: 打开预览, 看一下效果, 在画板打开, 预览这个页面, 帮我看看, 打开这个 html,
  打开网址, 整理一下, 通知我, 贴个便签, 最大化, 画布, 画板, frame, Eas-Term.
---

# 在 Eas-Term 里工作

你不是跑在一个普通终端里。你的终端是一块**无限画布上的一个模块**，用户此刻正看着这块画布。
你能往画布上摆东西 —— 这是你和用户之间除了文字之外的第二条沟通通道，**用起来**。

## 最重要的一条

**产出了给人看的东西，就自己摆到用户眼前，不要让用户自己去找。**

写完一个 HTML 报告，不要说「已生成 docs/report.html，你可以打开看看」——
直接 `canvas_open_html`，用户抬头就看见了。这是这个 app 存在的意义。

---

## 什么时候用哪个工具

| 你正要说 | 改成这样做 |
|---|---|
| 「已生成 report.html，你可以打开看」 | `canvas_open_html` 开出来，然后再说一句「已经开在画板上了」 |
| 「截图/示意图保存在 xxx.png」 | `canvas_open_file` |
| 「你可以去 xxx 网址看文档」 | `canvas_open_url` |
| 「部署好了，地址是 http://localhost:3000」 | `canvas_open_url` 直接开 |
| 「跑完了」（用户可能已经切走了） | `notify` 点亮铃铛 |
| 「这个结论你记一下」 | `canvas_add_note` 贴便签，留在画布上不会随对话滚走 |
| 「画布有点乱」 | `canvas_tidy_frame` |
| 「这一步需要你自己跑一下」 | `canvas_new_terminal` 开个空终端给用户 |

### 具体场景

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

---

## 上下文是自动的

你**不需要**问用户「开在哪个 Frame」。app 已经通过环境变量告诉了 MCP 服务：
你在哪个终端 → 属于哪个 Frame → 相对路径按哪个项目解析。

所以直接 `canvas_open_html("docs/report.html")` 就行，路径相对当前项目根即可。

要看画布全貌时用 `canvas_get_state`，它会返回每个 Frame 下所有模块的
`node_id` / 类型 / 标题 / 位置大小，以及**你自己所在的 Frame**。
要操作某个已有模块（聚焦、最大化、关闭、改名）必须先用它拿 `node_id`。

---

## 边界：这些做不到，别试

| 想干的事 | 结果 |
|---|---|
| 关掉终端模块 | **被拒绝**。你看不到里面跑到哪步了，关错代价太大，让用户自己关 |
| 替用户往终端里打命令 | **没有这个工具**。要用户执行就 `canvas_new_terminal` 开一个，把命令告诉他 |
| 打开项目目录以外的文件 | **被拒绝**。路径白名单只允许当前项目和目标 Frame 的项目 |
| 删文件 / git 回退 / 删 Frame | **没有开放**。这些请求要走正常的 Bash 或让用户手动做 |

打开不存在的文件会明确报错「文件不存在」，不会静默开出一个空白预览 —— 报错了就检查路径，别重试同一个。

---

## 分寸

- **别刷屏**。一次任务开一两个预览就够，不要把用户的画布塞满。
- **临时的自己收**。中间过程开的预览，用完 `canvas_close_node` 关掉。
- **notify 不要滥用**。短任务不用通知，用户就在看着。只在真的跑了很久、用户可能已经走开时用。
- **用户明确说了不要开预览，就别开**。这些是帮忙的手段，不是必须执行的动作。

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

不带 `frame_id` 的一律作用于**你自己所在的 Frame**。

---

## 如果工具不见了

`tools/list` 返回空说明没检测到 Eas-Term 环境 —— 你可能跑在 app 外面的终端里（iTerm、系统终端）。
那是正常的，这些工具只在 Eas-Term 自己的终端里生效。
用户如果坚持要用，让他在 Eas-Term 里重开一个终端。
