# Eas-Term 0.4.110 发布验收（2026-09-26）

- 默认主线构建：`692f679d1caaacbc0dbdac0e9c376c55fbfbaf3f`；`origin/main`、`v0.4.110^{}` 与构建提交在公开前一致。tag 是带注释 tag，直接 tag object SHA 不等于源码提交是正常的。
- `npm run check`：3760 通过、18 跳过、0 失败；`npm run build` 通过；更新日志格式检查通过。
- Windows main CI `36229789622` 与最终 tag CI `36230546262` 均成功，含安装包冒烟和真实 Windows 路径/文件 URL 专项；最终分发使用 **tag CI** 的 EXE（与 main CI 同源码，但安装包二进制哈希不同，不能混用）。
- Mac arm64、x64：Developer ID 签名、Apple 公证/staple、Gatekeeper 接受；双架构原始 App、DMG 和 ZIP 内 `app.asar` SHA256 同为 `b17c86cddafb66c265fc066362bb2c1575befa9e884035b9e052bb87a776e2f4`。两架构打包应用真实启动、渲染、preload、PTY、IPC、代码图谱、OMP、JS 错误冒烟通过；x64 在 Rosetta 下测，非实体 Intel。
- arm64 打包应用的页面观察/汇报页联动验收 38 项通过，截图生成于隔离用户目录；未替换本机 `/Applications/Eas-Term.app`。
- 五个最终包的大小和 SHA256 见 `artifacts.json`；官网服务器与 GitHub Release 的五个包逐项一致。网站及服务前后验证见 `distribution.md`。

## 保留问题

- 外部 Computer Use 指针残留的会话生命周期仍未解决，不能作为本版已修复功能。真实 Windows 用户机、实体 Intel Mac、在线模型端到端未做本轮现场验收。
- Windows 安装包未代码签名，SmartScreen 可能提示。
