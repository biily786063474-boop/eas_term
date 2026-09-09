# Agent网站入口约定
事实来源 src/shared/browserRoutes.json；此目录 routes.json / index.html 由 scripts/build-browser-routes.mjs 生成，禁止分别手改制造漂移。
- 读取routes.json，按intents/name匹配网站；status=pending必须询问准确网址，不能猜域名。
- 用户要“发布小红书笔记”：打开 https://creator.xiaohongshu.com/ 。不能用小红书首页代替创作者入口。
- 本地目录可直接打开 docs/browser/index.html#media，指定站点可用 #xiaohongshu。
- 打开网址优先可用MCP（Eas-Term canvas_open_url）；本地目录用canvas_open_html。这个页面只是入口，不是浏览器自动化/发布接口。
- 写笔记草稿与点击发布分开；路由命中不是发布授权，不能自动发送未经用户确认的正文。
- 不读取/导出Cookie、令牌或密码；让用户在网站UI正常登录。
- 当前“短视频助手”“Motion Sites”网址待确认。

## 正式接线（2026-09-09，覆盖上面的第一批未接线说明）
- `browser_routes` MCP 返回内置 catalog、应用内 `entryUrl` 和随包 `htmlPath`，不读取个人收藏或登录凭证。
- `canvas_open_url({url:"eas-favorites://home?folder=media"})` 打开自媒体收藏分类。
- `canvas_open_url({url:"eas-favorites://save?folder=media&name=示例&url=https%3A%2F%2Fexample.com"})` 只打开预填收藏表单；用户取消无写入。
- 项目内 HTML 用 `canvas_open_html` 打开 `docs/browser/index.html#bookmark`，其分类链接与表单在内嵌浏览器里跳转到真实收藏 UI。系统浏览器中 HTML 仍可阅读与点击公共网站，但应用内收藏链接不是操作系统级协议。
- 随包资源：`resources/browser/{index.html,routes.json}`；开发与打包脚本自动从共享源重建。安装版优先使用 MCP 返回的内部 entryUrl，不扩大 `canvas_open_html` 的项目路径白名单。
- 内置目录升级只追加未见过的新项目，保留改名、自定义及主动删除；个人收藏不会经此工具回传。
