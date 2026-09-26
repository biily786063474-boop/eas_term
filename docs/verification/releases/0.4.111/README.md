# Eas-Term 0.4.111 发布验收（2026-09-26）

- 默认最新主线构建：`ee1eeed01b16d8949876092ea38a1d1e9be02c01`；tag `v0.4.111^{}` 指向同一源码提交。
- Markdown 加粗强调色已在前一功能分支的亮暗主题、分屏与画布模式做实际 UI 验证；本轮主线 `npm run check` 与 `npm run build` 通过。
- Windows main CI `36246306277` 与 tag CI `36246848230` 均成功且 SHA 相同；分发采用 tag CI EXE，不复用 main CI 二进制。
- Mac arm64/x64 Developer ID 签名、Apple 公证与 staple、Gatekeeper 接受；打包 app 冒烟含渲染、preload、PTY、IPC、代码图谱、OMP 和 JS 错误检查，两架构均通过（x64 为 Rosetta 非实体 Intel）。两个 ZIP 与 app 内 `app.asar` SHA256 同为 `d3324068230a8cb9c0c61c1ea89bb8dcf32b7bddb6e481ac38fb90ebef06d8ef`。
- 五包大小和 SHA256 见 `artifacts.json`；官网/GitHub 分发核验见 `distribution.md`。

## 保留问题

- 外部 Computer Use 指针残留仍未完成会话生命周期验收，本版不宣称修复。
- Windows 安装包未代码签名，可能出现 SmartScreen 提示；实体 Intel Mac、真实 Windows 用户机及在线模型端到端未做本轮现场验收。
