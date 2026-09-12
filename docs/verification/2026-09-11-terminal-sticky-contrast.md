# 终端吸顶文字对比度

用户截图：/var/folders/7s/29s7qf5s7w778xnb_txz3_q00000gn/T/eas-term-paste/paste-20260911-192112.png

问题：亮色终端内部 CLI 吸顶条深灰背景配深灰前景。
定位：TerminalView 使用 xterm，未启用 minimumContrastRatio；主题前景只适合普通浅色底，无法覆盖 CLI 自带 RGB/256 色背景。没有应用层 sticky DOM 需要改。
改动：启用 xterm 单元格 minimumContrastRatio:4.5，保留 ANSI 数据、背景与滚动行为。

验证：配置回归测试先失败后通过；npm run typecheck/build通过。隔离 verify-app --port9461，实际亮色终端执行 printf RGB 背景58/58/58 + 前景80/80/80，顶部条文字已被修正为清楚的浅灰色，正文仍深色。dim 弱化行仍较淡，这是 xterm 原生 dim 规则（不能声称每种 dim 都达到4.5）。
未验证：用户原 Claude Code 会话的确切 ANSI 样式、真实滚动吸顶交互、暗色完整回归。未发布，不影响当前正式实例。
