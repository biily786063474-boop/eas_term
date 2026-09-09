# 浏览器本轮第一批（未完成整轮）
- 路由两项测试通过；单一JSON与本地HTML生成完成。
- 蓝图hover源码回归红→绿；真实组件Electron红→绿（同面板空白仍OPEN→CLOSED）。
- 应用build通过，基线typecheck通过；完整check尚未跑。
- 实际构建应用从词典浮窗进入蓝图验收通过，截图dict-hover/hover.png与leave.png已查看。
- 首次应用脚本误用addFileNode(kind:dict)，该路径不展示词典，失败Cannot read properties of undefined (reading click)；修正到真实setDictOpen入口后通过。不是隐藏失败。
- 正式收藏/截图/agent MCP路由发现/HTML表单深链接/收回性能与Windows验收未完成。
