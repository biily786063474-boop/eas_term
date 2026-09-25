# Eas-Term 0.4.109 发布验收（2026-09-25）

最终安装包均从 tag `v0.4.109` 的提交 `1829e691` 构建；该提交基于最新 `main`，包含 Frame 菜单、时间线原问题、灵动岛预览修正。产品代码与先前候选 `09caa6da` 相同，但最终以 tag 构建为准。外部 Computer Use 指针残留仍开放，本版不宣称修复。

## 本地和 CI 已验证

- `npm run check`：3710 项，3691 通过、19 跳过、0 失败；`npm run build` 通过。
- Windows Actions `36118636770`：tag 源码 SHA `1829e6910ff13bafa495b8628cc324a12af86f41`，completed/success；安装包已取回本地。先前候选 run `36114498097` 也通过，但不作为最终分发包。
- Mac arm64 / x64：Developer ID 签名与 Apple 公证、stapler 和 Gatekeeper 均通过。两架构 `app.asar` SHA256 同为 `abf8606e5d52c53b267da14821c9c23dd3115adeb1ea98f49df58cab1c6b6a7a`。
- ZIP、DMG 内两架构 App 均通过 stapler、Gatekeeper，`app.asar` 与候选 App 同 SHA256。
- 双架构打包 App 的 CDP 冒烟：界面、preload、PTY、IPC、代码图谱、OMP、JS 错误检查通过；x64 为 Rosetta，非实体 Intel。
- Frame 右键菜单此前已在隔离应用的亮/暗主题下逐项验证，证据见 `docs/verification/frame-context-menu/`。

## 安装包 SHA256

- arm64 DMG: `09b187365b33609e0ade9e2f2b40208c8b2a8b114115d286565969bb50c1f03c`
- arm64 ZIP: `f8dbe939017c5c16614cb2f33c42825946f6f8ba44639afab71903efefb44eb2`
- x64 DMG: `72a1f0da73fe09fd219cc20accad4e4260ebd7b22e1dbfec059ca075a120f565`
- x64 ZIP: `9dea85a6c84f9e90aff408624bf1c4443cdebb9559076b3530440bf9346f60a2`
- Windows EXE: `6e8b01a5b2ea242b48f154ce6dfb4dd7c74c98619d9c623e2096e5e093f69566`

## 尚待验证

- 实体 Intel 和 Windows 用户设备。
