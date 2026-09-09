# 浏览器本轮第一批（未完成整轮）
- 路由两项测试通过；单一JSON与本地HTML生成完成。
- 蓝图hover源码回归红→绿；真实组件Electron红→绿（同面板空白仍OPEN→CLOSED）。
- 应用build通过，基线typecheck通过；完整check尚未跑。
- 实际构建应用从词典浮窗进入蓝图验收通过，截图dict-hover/hover.png与leave.png已查看。
- 首次应用脚本误用addFileNode(kind:dict)，该路径不展示词典，失败Cannot read properties of undefined (reading click)；修正到真实setDictOpen入口后通过。不是隐藏失败。
- 正式收藏/截图/agent MCP路由发现/HTML表单深链接/收回性能与Windows验收未完成。

## 2026-09-09 联合回归（覆盖上面的第一批状态）
- 收藏模型 5 项、恒定布局 FLIP 2 项；完整 check 已通过，最新命令与计数见收口记录。
- `verify-browser-workflow.mjs`：真实页面标题/网址→新建目录+贴纸→自动选择→显式预览→保存→进入；缩略图实际加载、删除回收、捕获失败仍保存。网页 guest 无 preload/Node 权限；损坏数据与普通/悬空软链接拒绝且不覆写。自定义协议仅本地只读图片，CSP 只增加该 img-src，不放开脚本或外部资源。
- 复用同一隔离 profile，完整结束进程再重开：HTTP Cookie 登录 fixture 与自定义目录保持，见 restart-second/result.json。没有导入或测试用户真实网站账号。
- 生成的 standalone HTML 表单也在实际 webview 中提交并打开真实收藏表单；取消无保存。MCP schema 共39项，browser_routes只读；路由API在真实应用读到包内文件与小红书创作者映射。
- `verify-browser-wave.mjs`：五目录、340px直排卡、拖拽不误开、右侧提示到末尾消失、缩回期间其他模块尺寸不归零。浏览器/组件/自由节点/PaneView(AI启动页)四宿主各5轮最大化还原，共20轮，DOM身份保持；reduced-motion测试通过。没有运行真实终端输出/付费AI对话，不能据此宣称所有负载和所有机器无卡顿。
- 字典同位置 actual hover/leave 回归通过，见 dict-final；暗/亮截图与真实保存预览已实际查看。亮色导航曾发现暗底黑字，改为主题底色后再构建回归。

### 性能证据与边界
`geometry-before`记录display:none兄弟节点宽0；新实现保留480px。旧首轮收回最大帧间隔175ms，暖机后约10ms；`final/performance.json`是同设备同2模块场景修复后5轮数据。中间实验的GPU trace明确出现~115ms RasterDecoder；维持旧内容布局、仅缩放transform后这段不再压在收回开头。仍有动画结束后的约50ms冷收尾，不承诺绝对零掉帧。持续will-change与去Frame模糊没有收益，均已撤回。
`final/mixed-memory.json`是20轮期间每轮GC后的JS heap；测试中约9MB，无持续单调增长；不是整机GPU/长期内存保证。公开网站内容与低端Windows GPU仍需用户实机验收。

### 失败原样归档
- 首次全量check：infinite fav-breathe动画包含box-shadow，门禁拒绝；改固定阴影+opacity，不删除门禁。
- 工具schema断言39 !== 38；新增browser_routes后同步明确数量并验证新工具存在。
- 新预览协议第一次真实应用验证失败 `saved local preview renders`，根因img-src未登记；只补新只读scheme许可后回归通过。
- 重启脚本曾读到旧DevToolsActivePort而ECONNREFUSED；随后首次取DOM过早/取旧节点失败。清旧端口文件、等待恢复、按fixture节点定位后重启通过，未改应用加载逻辑掩盖测试问题。
- 混合脚本曾误把addAgentNode返回的leafId当nodeId，以及试图把带React引用的DOM按值回传（Object reference chain is too long）；纠正测试定位/返回值后通过。
- 初始stress脚本重复创建null项目Frame被单实例限制，内容上限还移除了目标，结果不作为证据。脚本已改不同fixture项目ID。

### 交付范围
仅隔离开发实例验收，不合并主分支、不替换正式版、不发布。Windows实机/安装包未测。Motion Sites与短视频助手准确URL待用户确认，保留pending卡片；未伪造真实网站预览。运行`node scripts/open-browser-acceptance.mjs`可打开独立profile，窗口由用户关闭，不自动结束验收。

### 最终命令结果
- `npm run check`：2805 tests，2792 pass，13 skip，0 fail；类型/Hook/对比度/CSS/动画门禁均通过。
- `npm run build`：成功（本轮未改版本号）。
- `verify-browser-wave.mjs`：35项实际界面/布局/交互检查通过，4宿主×5轮；latest冷帧最大58.4ms、暖机10.1–10.3ms，见performance-comparison.json；不是“全场景零掉帧”。
- `verify-browser-workflow.mjs`：19项通过；`verify-dict-blueprint-hover.mjs`：2项通过；跨进程重启3项通过。
- 已打开`open-browser-acceptance.mjs`独立实例，主Frame名“开发验收 · 收藏与模块动效”，内含收藏首页、Git组件、AI启动页与本地预览示例。程序不自动关闭验收窗口。

### 独立复审补充
reviewer发现PaneView在非100%画布比例下，旧视觉终点遗漏canvasRect.scale。已将该宿主传入的w/h改为视觉尺寸，四宿主用显式maximized变化触发，避免把常规缩放误判成最大化；还原方向明确传递，不再以面积比判断。新增50%/150%实际动画末帧→释放后的几何对比，记录zoom-endpoints.json。此前20轮比例1测试不能覆盖这项，未据此忽略复审。
