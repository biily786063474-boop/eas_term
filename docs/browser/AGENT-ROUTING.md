# Agent网站入口约定
事实来源 src/shared/browserRoutes.json；此目录 routes.json / index.html 由 scripts/build-browser-routes.mjs 生成，禁止分别手改制造漂移。
- 读取routes.json，按intents/name匹配网站；status=pending必须询问准确网址，不能猜域名。
- 用户要“发布小红书笔记”：打开 https://creator.xiaohongshu.com/ 。不能用小红书首页代替创作者入口。
- 本地目录可直接打开 docs/browser/index.html#media，指定站点可用 #xiaohongshu。
- 打开网址优先可用MCP（Eas-Term canvas_open_url）；本地目录用canvas_open_html。这个页面只是入口，不是浏览器自动化/发布接口。
- 写笔记草稿与点击发布分开；路由命中不是发布授权，不能自动发送未经用户确认的正文。
- 不读取/导出Cookie、令牌或密码；让用户在网站UI正常登录。
- 当前“短视频助手”“Motion Sites”网址待确认。
- 当前HTML是只读入口；收藏表单的deep link、安装包资源路径与MCP路由查询仍待实现，不以原型代替产品。
