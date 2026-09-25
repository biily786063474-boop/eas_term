---
name: release
description: Use when publishing or preparing an Eas-Term desktop app release, including 发版、分发、发布新版、推送安装包 or updating latest.
---

# Eas-Term 桌面端发版

此 skill 管**主程序**发版；插件市场独立包发布走 `docs/verification/plugin-marketplace/publishing.md`，不能把插件目录上线冒充主程序发版。执行前读 `AGENTS.md`、`docs/verification/releases/computer-use-lifecycle.md`、最近两版 `docs/verification/releases/` 记录，以及当前发布脚本；涉及服务器先按全局服务器 INDEX → 目标机器档案路由。发布不等于替换用户本机正在运行的 `/Applications/Eas-Term.app`。

## 0. 源码选择硬闸：默认最新 main

用户未**明确说出**要发布哪个分支或提交时，一律发布**最新 `origin/main` 已合并内容**。不能因当前 shell 恰好在某功能/集成/release 分支或旧工作树，就从它发版。「继续发版」「把刚才的发了」不构成分支例外。

1. `git fetch origin main`；记录 `BASE_SHA=$(git rev-parse origin/main)`，列出与当前工作树/候选分支的差异。若有用户期待但尚未合入的功能，先告知并按用户的合并指令安全合入 main；不静默遗漏，也不擅自 cherry-pick。
2. 从 `BASE_SHA` 建**干净的隔离发布工作树**；不能把主工作树未提交文件、旧构建缓存或旧 release 分支当源码。发布分支只能在该基线上增加版本号、发布元数据及经审查的发布修复；业务代码变更先合入 main 再重新定基线。
3. bump、全量检查、构建与应用验收后，冻结 `BUILD_SHA=$(git rev-parse HEAD)`。Mac ARM/Intel 与 Windows CI 必须来自同一 `BUILD_SHA`（核对 Windows run 的 `head_sha`；不能复用旧 artifact），tag 指向它；逐包核对大小/SHA256 和签名/公证结果。
4. **上传或切公开 `latest` 前再次** `git fetch origin main`。若 `origin/main` 不再是 `BUILD_SHA` 的祖先，说明主线前进：停止发布，安全合入新主线并重做检查、两平台构建与验收。不得仅改版本号、强推或把旧包标成新源码。
5. 默认发布必须把 `BUILD_SHA` 合入并推送 main，并核实远端 main 与构建提交一致（或在有发布后记录提交时，其源码树与构建提交一致），再切公开 `latest`。记录 `BASE_SHA → BUILD_SHA → tag → Mac/Windows run/产物哈希 → 线上 latest`；单看版本号不算验证。

**唯一例外**：用户明确指定某分支/提交发版。按指定 ref 冻结 SHA，报告醒目标注「非默认主线发布」及未包含的 main 提交；不得声称包含最新主线全部内容。若指定内容会回退线上功能，先明确风险并取得确认。用户没点名分支时不问，直接走 main。

## 1. 常规发版链

- 读当前版本、发布脚本和最近发布证据；分发前审查、`npm run check`、`npm run build`、隔离应用实测。构建失败/跳过项如实记录，不用开发实例冒充正式签名安装包。
- Windows 包只认 GitHub Actions 完成的同 SHA run，跟踪到完成，下载后验哈希；Mac 双架构需签名、公证、staple、Gatekeeper 与真实启动验收。3D 查看器依赖改动时先按 `scripts/publish-deps.sh` 处理，不能让新版按需下载 404。
- 按服务器档案做生产前后快照，安装包逐文件上传并核对大小/SHA256，网页及 `latest.json` 最后切换；不删除旧版本、不影响现有服务、不无必要重启。公开页面/清单/包验证后更新单机档案变更记录。
- GitHub Release 及官网双渠道各自核对。发布记录列明源码、平台、产物、回退位置、已知限制；Computer Use 指针生命周期未通过前不得标成已修复。
