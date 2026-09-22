# WPS 三件套真实验收 · 2026-09-22

环境：macOS arm64，已安装的 WPS Office 12.1.28496；插件分支 feat/plugin-market-unified-20260918（基线 1b8a47a + 当前未提交候选改动）。未重复安装/登录，未发布或替换正式 Eas-Term。

## 结果：三项本机文件往返通过

- Excel：真实 stdio 六工具生成工作簿、公式、双系列图表与透视表。修复值列标题未传入 Excelize `PivotTableField.Name`；先保留失败测试，再补 `Sum of Amount`。WPS 初开公式60，保存后 MCP 更新 B2=40，重开公式90、图表40/20/30、透视表East70/West20/总计90、标题仍存在；最终保存的公式 XML 缓存也是90。
- Word：真实 stdio 创建中文标题、分级标题、粗体、斜体、矩形表格；插件修订正文后，WPS 显示红色插入文字、作者 Eas-Term 验收和右侧删除记录。触发实际 WPS 序列化保存并关闭后，MCP 读回原修订和表格，再修订另一个简单段落；重开看到两条修订，作者/删除内容/原表格保留。再次 WPS 保存后 MCP 回读两条 tracked=true。
- PPT：真实 stdio 创建两页中文标题/正文。WPS 逐页打开；插件编辑第二页正文后重开正确。触发实际 WPS 序列化保存并关闭，MCP 再读并编辑，最终 WPS 第二页显示“真实往返通过：WPS 保存 → 插件修改 → WPS 重开。”，两页数量与布局保持。

## 证据与重跑

- `scripts/verify-wps-office.mjs`：真实 McpClient/stdio；phase create / edit / roundtrip-edit / final-read。人工 WPS 环节必须在对应 phase 之间执行，脚本不冒充 GUI 通过。
- `create-mcp.json`、`edit-mcp.json`、`roundtrip-edit-mcp.json`、`final-read-mcp.json`：各阶段工具参数、结果、SHA256。
- `wps-saved-*`：实际 WPS 序列化后的输入，供 roundtrip-edit 使用；Word app.xml 明确 WPS Office_12.1.28496，PPT app.xml 为 WPS 表格（WPS 自己写入的元数据）。
- `wps-table.xlsx`、`wps-document.docx`、`wps-slides.pptx`：最终实机查看样本。
- `final-assertions.json`：文件哈希、Excel缓存90/透视标题、Word两条修订、PPT两页断言均通过。
- `pivot-caption-red.txt`：修复前明确失败，标题为空。
- `excel-regression.txt`：Go test/vet、三目标构建、真实打包stdio六工具通过；三目标构建不是三平台GUI验收。
- `word-ppt-regression.txt`：Word/PPT 13项自动测试全部通过。
- WPS 原生截图已在会话逐项查看，未另行伪造渲染图作为 WPS 截图。

## 此次发现并沉淀

1. Word/PPT 未修改文档时 Command+S 可能不重写文件；初轮命令后哈希与生成文件完全相同，不能算“WPS 保存后兼容”。本次额外在样本文本中输入再删除空格，确认字节变化和 WPS 元数据，再做第二轮插件编辑。原 edit 阶段仅算首次插件修改；真正 WPS 往返证据是 roundtrip-edit。
2. Finder 画廊项目可能不可见，secondary Open 可能无结果；改为列表定位精确路径。先检查 WPS 窗口名再操作，不能把旧 wps-roundtrip.xlsx / wps-fixed.xlsx 当新样本。
3. WPS 坐标点击两次返回 noWindowsAvailable，键盘切页/文本编辑正常；未全局杀进程或改安全策略。

## 边界

本轮仅证明当前 Mac WPS 与现有插件已实现范围的真实文件往返，不代表 Microsoft Office/Windows GUI 或所有高级功能已验收。Word 不含页眉/文本框/复杂段落修订，PPT 不含动画/图表编辑与自动重排。Excel 1.1.0 原生候选在 `/tmp/eas-excel-plugin-20260922-wps-office`，尚未替换默认市场旧包；原始安全扫描非零结论保留。本次不发布、不部署、不把32项市场总目标标完成。
