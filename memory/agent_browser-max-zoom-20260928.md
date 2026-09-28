# 浏览器最大化比例入口 · 2026-09-28
工作树 /private/tmp/eas-chat-media-steer-integrate-20260928 已切到新分支 fix/browser-max-zoom-20260928，基线 b06d5735。该目录旧聊天图片整合任务已结束且已推main，当前未提交diff全为浏览器比例修复。

根因：canvas-zoombar.on-max有意隐藏画布缩放条，WebView未补网页比例按钮。恢复方式：Frame/自由浏览器最大化时，WebView接onZoomChange→setMaxScale，地址栏显示−/比例/＋，共享0.5–3范围，控制原生guest zoomFactor，不改画布。dom-ready应用zoomRef处理刷新/懒挂载。

2项单测先红后绿；全量3984通过/19跳过/0失败，build成功；独立只读审查无Critical/Important；真实Electron7项与截图已看，刷新验证已从固定等待改为明确等dom-ready。证据docs/verification/browser-max-zoom/，图纸10/14已同步。

未提交、合并、发版。用户当前仅要求修复；如果后续要求提交则默认推送，安全整合新origin/main，不碰原根脏分支。
