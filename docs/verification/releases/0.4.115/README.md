# Eas-Term 0.4.115 发布验收

## 源码与范围
- 上一公开版本：v0.4.114 / 527b0bc17413143721297ae6feb6acf1d5e1c56d。
- 初始最新主线：6b6f72e4；审查修复先合主线：8151f415cac865fb3d75ae5d4058a0d0e5631074。
- 冻结构建 / main / tag v0.4.115：4b68502f8942ab0baf3d59e7780a227824818b18。从隔离干净发布树构建，不混入原工作树未提交内容。
- Windows tag CI：36425319916，同 SHA，success；同 SHA 重复 main CI 36425935943 已取消，不影响 tag 构建。
- 功能及兼容要求见 release-notes.md；Jev 0.2.0 的独立插件市场发布不在本次范围。

## 审查与回归
独立代码审查发现 Jev 市场旧包连接恢复/时间线增强两项阻断，按有效协议能力分流后复审通过。真实 v2 测试又发现 manifest 解析丢失 requirements，先补失败测试再修复；没有把协议声明当权限授予，也没有绕开路径、凭证、取消或所有权保护。完整红绿记录和旧12项/新21项实际 Electron 验收见 ../../jev-legacy-release/。

最终 npm run check：3989 测试，3971 通过、18 跳过、0 失败、0 取消。构建、renderer entry、原生 helper、OMP 18.1.2 实际握手通过，npm audit 0。详见 test-summary.json / audit.json。
- 用量：真实 Electron 隔离数据 90 天热力图，默认 Token，软件活跃切换、真实操作计数、深浅色和原详情回归；截图见 usage-activity/。模拟历史不是用户历史。
- Codex：真实 Electron + 控制 CLI 夹具验证 1/5、5/5 提示，六个独立进程、停止不重发、耗尽不启动第七次；不是线上付费模型验收，见 codex-retry-20260927/。
- Mac ARM/x64：正式签名包真实启动，preload 60 命名空间、PTY、IPC、图谱懒加载和随包 OMP 通过，无 JS 报错；设置界面截图已检查。系统沙箱保持开启。x64 在 Rosetta 下运行，非实体 Intel。
- 两架构 Developer ID 签名、公证、staple、Gatekeeper 通过；只读挂载 DMG 及 ZIP 内 asar 与 app 一致，两架构 asar 一致，见 mac-verification.json。
- Windows：同提交 CI 完整构建及打包回归成功；下载 EXE 与 GitHub size/digest 一致，CI 设置实际鼠标点击/IPC 持久化、清理成功截图与 JSON 已收录；非用户实体机器验收。

## 失败尝试与边界（不隐瞒）
- v2 初次材料调用超时与修复过程保留在 Jev 证据中。
- npm audit 初次网络请求无响应，停止所属 npm 后旧 JSON 解析报 Unexpected end；有超时限制的重试成功为 0 漏洞。
- 按本机网络 SOP 对 registry.npmjs.org 增加单域名 DIRECT（源 profile / runtime / 热加载）。初次 YAML 列表缩进错误导致 reload 400，运行态未变；随后更正为原列表缩进，reload 204 并核对规则。未改其他路由、未杀连接。
- ARM 初次 CDP 截图停留在先前画布帧，DOM 已显示设置；重新启动正式包捕获并亲眼确认设置界面，最终截图为复验。
- 既有 MaxListenersExceededWarning（11 before-quit listeners）仍可见，未冒充本轮修复。
- Computer Use 外部指针生命周期仍未解决；真实在线模型/TypeSafe、真实一小时内存与物理多显示器、实体 Windows/Intel 未验。
- Windows 安装包未代码签名，可能触发 SmartScreen。macOS 12+；macOS 11 保留 0.4.113 下载，旧客户端不自动阻止不兼容下载。
- 未替换 /Applications/Eas-Term.app，未改用户真实数据或插件，未发布 Jev 独立包，未清理旧包。

## 分发
构建验收及官网/GitHub双渠道发布已完成，详见 distribution.md。五包清单 artifacts.json；发布前后服务和公网核对分别见 services-*/health-*、official-public-verification.json 与 github-assets-final.json。
