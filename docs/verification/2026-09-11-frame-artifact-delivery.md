# AI 产物默认交付到所属 Frame

## 已确认的边界
MCP 明确提交产物，代码负责展示。不新增 secret/shell 执行面，不解析自然语言路径、不监听任意文件写入。AI 回复本次产物前用现有 canvas_open_file/html/image 提交；参考文档、用户输入图片不自动打开。未调用 MCP 不承诺自动识别。

## 实现
- 新增 openArtifact 统一新建/复用/刷新；artifactNode 只匹配同 Frame 同类型同文件。
- 图片、文件、HTML 都保留原路径权限检查。文件 IO 后再次核对调用会话所属 Frame。
- 重复提交沿用节点 ID、位置、尺寸、固定状态，不耗新名额，不触发 FIFO。
- CodeView 未保存编辑时延后刷新；图片版本 URL 避免缓存。HTML 复用时刷新预览组件。
- 已更新内置能力 guidance、MCP 工具描述与模块领地图。

## 验证
- targeted tests：8 项 renderer image branch/matcher + 2 项真实 openArtifact 模块 mock-store 测试通过。
- typecheck/build 成功。
- 隔离 Electron 实际 /invoke，ctx 明确指定 cnode-image-test：图片和 Markdown 各调用两次，第二次返回原 nodeId 且 reused=true；Frame 两个内容节点，2/5。CUA 亲眼看到两种预览。
- 未单独实测 HTML 刷新、未保存编辑延后刷新、更新图片内容后的缓存刷新；这些不报已验收。
- 未发版。最终全量 check 见 /tmp/eas-artifact-full-check.log。
- 全量 npm run check 退出码 0，具体计数见日志。实际 /invoke 传失效 agentNodeId，被拒绝，未兜底到同项目 Frame。
