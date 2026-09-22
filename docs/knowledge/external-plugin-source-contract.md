# 外部插件接入口（Eas 目录协议）

用户入口：插件市场 → 添加外部来源。无需给 Eas 开发者提供市场地址逐家接入。

## 首版支持
- 公开 HTTPS 的 Eas registry schema 1/2 目录（v2需unavailable数组）。地址不能包含凭据、query、fragment、自定义端口、IP或本地域名。来源名称最多80字，最多20个外部源。
- 插件 ZIP 与目录必须同 origin；CDN跨域、重定向、不公开DNS、私网/fake-IP均拒绝。沿用受限代理/TLS与连接地址固定，不绕过证书。外部下载继承16MB流限额，目录2MB/60秒整段上限。
- 目录每条必须有name/displayName/version/url/sha256/size；版本数字x.y.z，sha256为真实ZIP摘要，size为真实字节数。permissions/requirements与包内一致。
- ZIP根部必须直接有 plugin.json；其name应与目录条目一致，版本一致；支持现有Eas stdio/面板协议，远程能力仍受当前宿主能力门禁。
- 仓库脚本 `scripts/pack-plugin.mjs` 可为兼容目录生成ZIP及条目；要求requirements的包使用packPlugin({registrySchema:2})或双目录builder。不要只把网页URL放进目录。

目录形状：`{"schema":2,"plugins":[条目],"unavailable":[]}`。正式示例可参照现有 `/plugins/v2/registry.json`。由发布者输出真实哈希与尺寸，不提供能误装的伪哈希示例。

## 用户确认与更新
添加来源先原生确认信任地址；不安装、不执行插件。安装另有版本/权限/来源与可执行代码提示。软件把来源收据写入包暂存目录，再与包一起晋升/回退；保留项目历史与配置。
更新只接受原sourceId；同名其他源/未知旧安装/同名内置插件不允许被外部源覆盖。需要同时用同名多源插件不是首版范围。来源移除保留安装包与数据，但取消该来源待确认安装；重新添加产生新代次，不复活旧确认。
官方旧安装保留既有迁移路径；不会把未知旧副本自动绑定第三方。安装包不得自带宿主保留文件 `.eas-market-source.json`。

## 明确不支持
不是“任意网址都能安装”，不自动兼容Claude/Codex/VS Code/浏览器专属插件、不执行任意仓库安装脚本。不接认证私有市场或URL密钥。未来可追加目录适配器，不应放宽包校验或复用别家的登录凭据。
