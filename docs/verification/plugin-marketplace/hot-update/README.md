# 同进程独立更新验收

运行 `npm run build && node scripts/verify-plugin-hot-update.mjs`，仅支持当前 macOS 隔离验证。

范围：实际编译应用、真实预加载 IPC 与市场 UI，点击安装/刷新/更新/权限确认，随后供给损坏更新和离线目录，读取临时插件目录验证版本保持。全程同一应用 PID，更新期间不重建宿主。

隔离边界：单独 userData；OS 沙箱禁止读取/写入真实 CLI 配置及 `.eas` 等凭证目录；清除继承的常见 key/token 环境变量。临时启动适配器将 Node `os.homedir()` 指向临时目录，并只把 fixture 的官方格式包 URL 重定向至本机受控服务器，不改变产品代码或允许列表。保留原生 HOME，避免 macOS/Electron 新 HOME 下的 renderer/CDP 卡顿；这是测试适配，不是正式安装路径变更。

**不覆盖**生产 HTTPS/TLS/CDN、远程账户、实际三 CLI 模型、插件业务工具（fixture server 是惰性测试文件）；损坏包保留证明下载失败不替换旧版，不等于断电崩溃恢复证明。

调试历程：早期 inspector Promise was collected；改变原生 HOME 的多次尝试出现 CDP Runtime.evaluate/Page.captureScreenshot 超时，原 compatibility verifier 对照通过。使用临时启动适配器后，UI 红测明确报“市场提供显式刷新目录入口”，随后实现该入口。成功结果以 result.json 为准，不以旧截图或 failure.json 判定。

最终结果：全量 `npm run check` 3344 项（3326 通过、18 跳过、0 失败），构建通过；本脚本 13 项通过，旧授权/兼容性脚本 7 项通过。截图 `updated.png`、`failed-update.png` 已眼验。`layout-red.json` 是修复前的卡片溢出红测，不是当前结果。上线/真实账户/32项业务连接器仍未验收。
