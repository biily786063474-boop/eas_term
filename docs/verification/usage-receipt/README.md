# 用量小票验收 · 2026-09-21

实现工作树：`/private/tmp/eas-timeline-integrate`，未提交，未安装正式版。

- `npm run typecheck`、`npm run build` 通过。
- 用量单测 + receipt 范围/转义/未知值测试 + 趋势/抽屉测试：27 通过。
- `node scripts/verify-usage-receipt-service.mjs`：真实 Electron IPC；PNG 剪贴板、PNG 写文件、取消保存、非法输入与越界路径拒绝通过。保存对话框为测试桩，未实际手动点系统保存面板。预期拒绝会打印“无效的小票尺寸/图片”错误；不是未处理故障。
- `node scripts/verify-usage-receipt.mjs`：真实隔离窗口，自然周/月按钮、打印中负 Y 位移、居中、文本与图片复制、Esc、减少动态效果通过。
- 原 `verify-usage-project-expansion.mjs` 全部通过，两层三条/折叠/项目独立分页未回退。
- `printing.png` 是打印中实拍，`weekly.png` 是居中预览实拍，`receipt.png` 是完整 880×1600 PNG。均为 fixture 模拟用量，不是用户账单。
- 小窗口预览可滚动，导出图片完整包含脚注和齿边。
- 初轮发现并修复：macOS 大小写解析冲突（纯函数改名 receiptReport）、全局 margin reset 导致 dialog 靠左上（显式 margin:auto）。
- 初轮自动化后台时动画被已有后台节能规则暂停；测试改为仅激活自己拥有的 fixture PID，不改产品后台策略。
- 未验证 Windows、第三方聊天软件的粘贴界面；未增加网络调用、安装依赖或改账本计费口径。

当前体验实例：CDP 9452，启动 `scripts/verify-usage-drawer.mjs`，独立临时 userData，日志 `/tmp/eas-usage-experience.log`。只按端口+命令行确认自己的实例，不全局杀进程。

真实鼠标补测发现并修复 portal 与抽屉外点收起冲突：`CanvasWikiDrawer` 将 `.ur-dialog` 纳入逻辑内部区域。测试已由 DOM `.click()` 升级为 CDP mousePressed/mouseReleased 点击复制按钮，修复前小票消失，修复后完整流程通过。最终自动化覆盖的是实际鼠标事件，不仅是程序触发 click。

出纸真实感追加：已构建、typecheck、隔离实例真机验证。定位旧机身 z-index 遮住纸张直到机身底部的问题，改为槽口内部出纸；增加预览弯曲透视、回落与阴影，完整 PNG 保持平整。截图已更新。旧实例 CDP surface 截图发生超时，未当成功；重启所属隔离实例后以窗口截图重新验收通过。
