# 市场详情文案来源与边界

2026-09-23 从公开 `https://eas.biily.top/plugins/v2/registry.json` 读取 8 个条目，逐个下载公开 ZIP 并核对 SHA-256，查阅包内 `plugin.json`、`server.mjs` / `lib/connector.mjs` 的 `tools/list` 定义后编写详情。每份 JSON 均绑定名称、版本、包 SHA-256；包一变，旧文案不再被客户端回退使用，也不会被 registry 构建器附入。Jev 的可选工具只有连接且在面板启用时才出现在工具列表。

本目录是展示文案，不授予权限，不代替安装确认，也不是插件包。`scripts/plugin-registry-build.mjs` 通过 `detailsRoot` 可将匹配内容写入 **v2** 目录；本次未发布或改动生产目录。未验证在线模型真实返回、物理 Windows UI、所有外部来源的自述准确性。
