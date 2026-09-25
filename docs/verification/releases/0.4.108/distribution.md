# 0.4.108 分发核对（2026-09-25）

- 主线源码候选 `a9ddf103`，仅发布页面/验收文档收尾提交 `7e6ac732`；`v0.4.108` tag 指向后者。两个 Windows Actions（main `36107620168`、tag `36107636085`）均 completed/success；候选打包 run `36105324267` 也 success，官网下载的 Windows 安装包来自该 run，源码行为与 tag 的差异只有页面/验收文档。
- Mac 双架构 Developer ID 签名、公证、ZIP/DMG 内 App 的 stapler/Gatekeeper 验证和隔离 CDP 冒烟通过；五包 SHA256 见 README。
- 五包逐个 SCP 到 `/www/wwwroot/eas-dl/v0.4.108/`，每个都核对 size/SHA256；之后三份官网 HTML 再更新，`latest.json` 最后原子切换。公网首页/下载/更新日志与五包 HEAD 均 200；`latest.json.version=0.4.108` 且有五个下载路径。未执行旧发布脚本，不 reload nginx，不删除旧包。
- 旧网页/`latest.json` 已在服务器原目录备份，后缀 `20260925T072655Z`。发布前后五个 PM2 均 online，eas/www/aurora/rove/bzone/spb 六站本地 Host 请求均保持 301；未检测到生产站状态变化。
- Jev 0.1.2 通过受保护发布器上架：release `5aaad4eb-8e40-42f1-aff7-3f383f00aa8f`，仅上传一个新包；v2 目录仍 8 项且其他七项与发布前一致，旧 v1 目录字节未变。公网目录与候选目录完全一致，公网 ZIP SHA256 `b6d6bfeb553afd174884a7ac0593c4a31156f220b06ec9918c347f7fcd3ec44e`。
- GitHub Release `v0.4.108` 于 `2026-09-25T07:32:55Z` 公开并成为 latest。五个 asset 的 size/digest 与本地包逐项一致。首次上传 Windows asset 时 GitHub 返回了错误 digest/截断大小，因此在 draft 状态删除并重传，重传后复核通过才公开。

## 未验证/已知限制
- 真实 TypeSafe 账号/付费请求、实体 Intel Mac、Windows 用户机、Linux 系统密钥后端未验证；外部 Computer Use 指针残留仍开放。Windows 包未代码签名，会遇到 SmartScreen 提示。正式用户应用未在本机替换。
