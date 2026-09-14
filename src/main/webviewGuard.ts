// S2（2026-09-14 评审）：主进程在 will-attach-webview 里把 <webview> 的 webPreferences 加固。
// 渲染层今天没给网页节点设 preload，但"约定不设"和"主进程不允许"是两回事——
// Electron 安全清单第 12 条就是这个钩子。零 electron，钩子在 index.ts 里挂。
export function hardenWebviewPreferences(prefs: Record<string, unknown>): Record<string, unknown> {
  delete prefs.preload
  delete prefs.preloadURL
  delete prefs.enableBlinkFeatures
  prefs.nodeIntegration = false
  prefs.nodeIntegrationInSubFrames = false
  prefs.contextIsolation = true
  prefs.webSecurity = true
  prefs.allowRunningInsecureContent = false
  prefs.nodeIntegrationInWorker = false
  prefs.webviewTag = false
  prefs.experimentalFeatures = false
  prefs.sandbox = true
  return prefs
}
