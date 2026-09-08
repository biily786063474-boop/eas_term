# 图片满额 FIFO · 待下次发版
用户于 2026-09-08 明确授权：新增图片时自动关闭当前 Frame 最早的未固定内容预览。

实现复用 store 现有 addFileNode → capContent → nodesToEvict，不复制淘汰策略；图片验证后重新确认所属 Frame，无 await 间隙地同步新增与清理。返回最终名额和 evicted_node_ids。没有删除源文件的调用。

边界：固定内容不占配额；终端、AI、组件不参与，其他 Frame 不参与。无效图片/Frame撤销不新增或清理。工具 destructiveHint 改为 true（影响画布内容），openWorldHint 保持 false；随包 SKILL/canvas/generate 说明同步。

验证：定向14/14；完整测试2774通过、12跳过、0失败；类型检查、构建通过。隔离实例9448的真实store连续新增6图后保留5图，原AI节点保留；实际MCP renderer分支由AST执行测试覆盖FIFO、固定/live保护和异步Frame复核。线上0.4.86仍满额拒绝，本次未伪称线上图片MCP已变更。

架构图 docs/prototype/2026-09-08-mcp-injection.html 已通过现有 canvas_open_html 放到当前Frame（cnode-43-cfvze），现有HTML FIFO关闭旧预览一个，源文件保留。图区分当前受管链路与待发图片FIFO，并注明旧兼容入口。

下一版本包含：本改动 + f2e61cb 登录误关闭防护/真实进度。发布前仍需正式包回归，不自动发版。
