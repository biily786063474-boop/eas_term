# 0.4.108 发布验收（2026-09-25）

候选源码来自 `a9ddf103`（含 `ed57cc32`）；Jev 插件候选 `0.1.2` 的包哈希见 `jev-plugin-candidate.json`。发布网页与最终状态另见本目录的分发记录。

## 已验证
- Node 22 独立依赖环境：`npm run check` 3669 通过、19 跳过、0 失败；`npm run build` 通过。
- 隔离 Electron：Jev 配置、解锁、等待反馈、插件三路连接共 42 项；密钥柜信任设备重启与手动锁定流程通过。
- 插件抽屉弹窗与必填密钥引导通过；市场详情、热更新、离线缓存回归通过。
- Jev `0.1.2` 包内容相对线上 `0.1.1` 仅 README、清单版本和面板变化；另外七个线上插件包与线上目录一致，未覆盖同版本包。
- Windows CI run `36105324267` 成功，源码 SHA `a9ddf10329c6da1f404e8bcbe6ce2c0f4aa8173f`；下载的安装包 SHA256 `2ec31c59085deca88649943c4d48599cc109a3ebf57775db35ac7c40ab693bee`。
- Mac arm64 与 x64 都使用 Developer ID 签名并通过 Apple 公证；x64 提交 ID `3887bbed-4d3d-4bc5-9f27-d708f3615677`。两个架构的 ZIP 与 DMG 内 App 均通过 stapler 验证和 Gatekeeper 评估，ZIP 中 `app.asar` 哈希相同（`358395d3d8818c9f23695b39451e6a8127f37e807aea17e571939f7094ece1b5`）。
- 两架构 App 均在独立 userData 通过 CDP 冒烟：界面渲染、preload、PTY、IPC、代码图谱、无 JS 报错、OMP。

## 安装包 SHA256
- `Eas-Term-0.4.108-arm64.dmg`: `f5fa9722708c1e2b5a9853e44802e9bc0b21fad4767f7b696d19b0a4636efe59`
- `Eas-Term-0.4.108-arm64.zip`: `5a30ae3310947d27ea607982c9eb2b340cd407399f290aff3955f4809041c834`
- `Eas-Term-0.4.108-x64.dmg`: `b7da906cfb0bc984ae8020676439ab4e30029b896fb615f6d81d6ea854417131`
- `Eas-Term-0.4.108-x64.zip`: `e4b0e25a050d7f2b4af083e64d8b0a61c130ef0638f44c1117cb7e7057a1c43d`
- `Eas-Term-0.4.108-x64-setup.exe`: `2ec31c59085deca88649943c4d48599cc109a3ebf57775db35ac7c40ab693bee`

## 仍需分发验证 / 已知边界
- 官网、自动更新、插件目录公网与 GitHub Release 的最终公开校验，在分发后记录；不能把本地包通过当成线上可用。
- 真实 TypeSafe 账号/付费请求、实体 Intel Mac、Windows 用户机、Linux 系统密钥后端未验证。外部 Computer Use 指针残留问题仍开放，不纳入本版已修复范围。
