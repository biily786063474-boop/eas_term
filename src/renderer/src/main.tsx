import ReactDOM from 'react-dom/client'
import { App } from './App'
import { useStore } from './store'
import { applyTheme, loadTheme } from './themes'
import { ErrorBoundary } from './ui/ErrorBoundary'
import { registerMcpHandler } from './mcpHandler'
import './styles/base.css'

// 渲染前先套用持久化的主题，避免首帧闪默认色
applyTheme(loadTheme())

// MCP：接住主进程转来的 AI 工具调用（画板能力对 Claude/Codex 开放）
registerMcpHandler()

// 全局错误兜底:渲染侧未捕获异常/拒绝不再静默丢失(白屏时至少能在控制台看到根因)
window.addEventListener('error', (e) => console.error('[window:error]', e.error ?? e.message))
window.addEventListener('unhandledrejection', (e) => console.error('[window:unhandledrejection]', e.reason))

// 开发调试入口：可在 DevTools 控制台直接操作全局状态。
// **验证实例也要有** —— scripts/verify-app.mjs 跑的是构建产物（DEV 为 false），
// 没有这个入口就只能查 DOM 反推状态，「leaf 挂没挂在 Frame 上」这类判断绕得很远。
// 它由 preload 读 EAS_VERIFY 决定，正式打包不带那个环境变量，用户版本照旧没有。
if (import.meta.env.DEV || (window as unknown as { __easVerify?: boolean }).__easVerify) {
  ;(window as unknown as Record<string, unknown>).__store = useStore
}

// 根级 ErrorBoundary:任一组件渲染抛错只落到兜底 UI,不再卸载整树成永久白屏
ReactDOM.createRoot(document.getElementById('root')!).render(
  <ErrorBoundary label="root">
    <App />
  </ErrorBoundary>
)
