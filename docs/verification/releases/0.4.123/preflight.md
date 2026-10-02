# 0.4.123 发布预检
- 源码：origin/main 283b296149eed1530f766dba4c671282f4da2e86，独立干净发布树 /private/tmp/eas-release-0.4.123；Node 22.23.3（~/.cache/eas-release-tools）独立 npm ci。
- 本版范围（相对 v0.4.122，仅两条修复）：对话图片放大统一走 ImagePopup（CLI 返回图不再贴左上角；自己贴的图读磁盘原图而非 96px 缩略图；新增缩放/拖动/双击/工具条/键盘，中英文案）；插件抽屉已装卡片描述改块级、面板禁横向滚动、长名字可收缩。
- 分发前审查：两条修复均为渲染层 UI，无新依赖、无新出站、无新进程、build/ 与签名未改；新增 IPC 调用仅复用已有 fs.readImageFile（原用于历史图片）读取消息里附件路径。新文案 viewer.zoom* 中英成对；新文件 ZoomableImage.tsx 已登记 migrated.json。
- npm audit --omit=dev：node-forge:high（node-forge GHSA-86w9-cpqp-85rv，评估同前：仅生成自签名证书，无 verify 调用）。
- npm run check：4371 测试，4352 通过、19 跳过、0 失败；npm run build 成功。
- 界面验收（发布树、隔离实例，中英各一遍，见 ui/）：verify-chat-image-viewer PASS（居中、原图 2400×1600、光标锚点 3px 内、拖动、1:1、键盘、双击、点空白关闭、自己贴的图读原图）；verify-plugin-card-overflow PASS（描述不越过开关、面板无横向溢出、横向滚轮不动）。修复分支上做过对照：原样式下描述越过开关 625px、面板被拖走 400px。
- 仍未覆盖：真实在线模型端到端；实体 Windows / Intel / macOS 12；长时内存；外部 Computer Use 指针残留。
