# 原始预览来源核查 · 2026-09-12

用户要求：卡片应使用每套选型台实际渲染页面的首屏截图，不使用统一配色示意。

当前问题：DesignPicker.Sample 是统一 CSS mock，只有背景文字色变化；不是图片加载失败，而是未接真实封面。

已定位：
- skill：/Users/biily/.claude/design-skills/design-system-picker/SKILL.md
- token 索引：/Users/biily/.claude/design-skills/design-system-picker/lib/index.json
- 完整备份：/Users/biily/Biily/cowork/设计规范/vechooool-backup
- 索引 previewHtml / designHtml 路径须相对完整备份的 design-library 解析，而非 skill/lib。307 条 previewHtml 均找到本地文件。
- projects/<slug>/meta.json 包含 previewHtmlSrc / designKitSrc 的真实远程原始页面地址。上一轮只补四个产品官网没有用到该索引，不是原预览站完整接入。

下一步：渲染原始 previewHtml、生成对应slug首屏封面；随应用打包封面和来源映射，懒加载图片；右侧复用同图；缺失明确标记；原预览入口用真实源映射。不能把色板mock或产品logo充当封面。需检查模板外部依赖与字体/资源加载，避免空白截图。尚未生成封面、尚未替换Sample。

## 实现记录 03:24 起
构建脚本 `scripts/design/render-covers.cjs` 使用独立 Electron userData/session、沙箱与 contextIsolation，禁止 Node 集成；远程请求只映射已有 CDN 镜像，否则阻断。仅离线渲染原 HTML 产出 JPEG，不使用模型生图。执行时传 DESIGN_BACKUP_ROOT、DESIGN_INDEX；macOS 加 `-ApplePersistenceIgnoreState YES` 防止截图子进程崩溃后系统恢复窗口提示阻塞启动。与正式用户会话隔离。
首轮脚本 require 使用了 Electron npm绝对路径（错误），改 builtin require；第二轮在创建/销毁多窗口时 SIGTRAP，改复用单窗口。之后系统恢复提示阻塞 whenReady，经sample栈定位后用单次进程启动参数恢复，未改全局配置。
