# 对话图片 popup 验证

- MessageList 附件与 Markdown 回复图片使用同一个 ImagePopup；旧 showInFolder 图片点击移除，链接点击规则不改。
- ChatNavView 复用同组件，移除旧 chat-lightbox CSS。
- body Portal + native modal dialog：等比例 contain、暗化模糊背景、关闭按钮/Esc/遮罩关闭，背景原生 inert。
- typecheck、build 成功；ImagePopup handler harness 2/2 通过（原生 modal 调用、关闭、焦点恢复）。
- 隔离真实 Electron + 测试历史，未调用模型：实际点用户附件弹出完整图片；Esc 关闭；点 assistant Markdown 图片也弹出；点击遮罩关闭。截图素材是用户提供的旧预设问题截图，不代表当前预设仍有问题。
- 专项实例数据路径记录于 /tmp/eas-image-verify-dir；当前进程 67345（launcher 67344），无真实凭证。原密钥柜验收实例已退出，隔离目录 eas-verify-Tn07Pu 保留，未删除测试柜。
- 未发版。未对 ChatNavView 单独做实际点击验收；复用组件已覆盖。
