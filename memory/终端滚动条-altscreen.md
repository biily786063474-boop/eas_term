# 终端滚动条在 Claude Code 里"消失"—— 根因与修法

> 记录日期：2026-07-09。用户反馈："跑 Claude Code 时终端滚动条不见了。"

## 根因（已用 pty 抓包确证）

用 Python pty 跑 `claude` 抓它启动时的控制序列，确认 Claude Code 开局就发：
- `\e[?1049h` → **切到 alternate screen（备用屏）**
- `\e[2J` → 清屏
- `\e[?1000h \e[?1002h \e[?1003h \e[?1006h` → **接管鼠标（mouse tracking）**

结论：
1. 备用屏**没有 scrollback**（就一屏），xterm 的 `.xterm-viewport` 无溢出 → WebKit 原生滚动条 thumb 自动隐藏（所有终端都一样，vim/top 同理）。
2. Claude Code 接管了鼠标，滚轮事件被发给它，它滚的是**自己内部**的对话（xterm 缓冲不变）。用户实测：滚轮**能**滚 Claude Code。

## 关键认知（用户第二轮澄清后）

用户真正想要的是 **Claude Code「回答区」自己的滚动条**（底部固定输入框、上面回答区那块）。
**终端做不到**：Claude Code 把整个 UI（回答区+输入框）当纯文本画在终端里，终端只看到字符网格，不知道回答区边界、也拿不到 Claude Code 的内部滚动进度。那条滚动条**只能 Claude Code 自己画**（属于 Claude Code 的功能，不是终端能补的）。iTerm2/Warp 同样如此。

## 已定修法（2026-07-09 用户拍板：普通终端留改进，Claude Code 里不画假的）

`TerminalView.tsx` 加了**自绘常驻滚动条** `.term-scrollbar`（盖在原生预留的 12px gutter 上，原生 thumb 已在 CSS 置透明仅留占位宽度）：
- **普通缓冲（正常 shell）**：常驻可见、随 `buffer.viewportY/length` 同步、可拖拽（`scrollToLine`）。
- **备用屏（`buffer.active.type === 'alternate'`：Claude Code/vim/top）**：`updateScrollbar` 里直接 `display:none` 隐藏——不画会误导的"假滚动条"，滚轮照常滚应用自己。
- 更新时机：`term.onRender` + `doFit`。

改动文件：`components/TerminalView.tsx`（自绘滚动条 DOM + updateScrollbar + 拖拽 + alt-screen 隐藏 + cleanup）、`styles.css`（原生 thumb 置透明保留宽度 + `.term-scrollbar`/`.term-scrollbar-thumb`）。typecheck+build 通过。

## 追加：滚动条补不了 → 改做两个快捷导航（2026-07-09，用户拍板）

用户接受"Claude Code 回答区滚动条终端补不了"后，改要两个替代：①常驻「回到最新」按钮 ②滚得更快。均已实现（`TerminalView.tsx` + `styles.css`）：
- **`scrollSensitivity: 3`**：普通缓冲滚轮步长加大。
- **`.term-jump`「↓ 最新」按钮**（右下角浮动药丸）：普通缓冲滚上去时才显、点击 `scrollToBottom()`；备用屏(Claude Code)常显、点击连发 80 次向下"合成滚轮"把应用推到底。
- **备用屏滚轮放大**：`onWheelAmplify`（capture，`synthesizing` 防重入）——alt-screen + `modes.mouseTrackingMode!=='none'` 时，把 1 次真实滚轮再补 2 次合成滚轮（≈3×）。
- 机制：`dispatchWheel()` 派发合成 `WheelEvent` 到 `.xterm-screen`，由 xterm 按当前模式编码（普通→scrollback；备用屏+鼠标→鼠标上报给 Claude Code）。
- **不确定点**：合成 WheelEvent 是否被 xterm 处理成鼠标上报（若 xterm 校验 isTrusted 会失效）。待用户在 Claude Code 里实测；若无效，改为直接 `pty.write` 构造 SGR 鼠标上报序列（`\e[<65;col;rowM`）。

## 未自测项（如实）

多窗口环境（用户打包版 Eas-Term 挂着多个活跃 Claude Code 会话，一直抢焦点）导致没法稳定把输入打到调试实例，**"普通 shell 显示 / Claude Code 隐藏"这半边没能亲手截图验证**，逻辑清晰但待用户在 dev（HMR 已热更）里眼验：开普通终端看滚动条常驻；开 Claude Code 看外框不再画假条、滚轮仍能滚。
