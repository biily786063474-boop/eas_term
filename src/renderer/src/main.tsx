import ReactDOM from 'react-dom/client'
import { App } from './App'
import { useStore } from './store'
import { applyTheme, loadTheme } from './themes'
import { ErrorBoundary } from './ui/ErrorBoundary'
import './styles/base.css'

// 渲染前先套用持久化的主题，避免首帧闪默认色
applyTheme(loadTheme())

// 全局错误兜底:渲染侧未捕获异常/拒绝不再静默丢失(白屏时至少能在控制台看到根因)
window.addEventListener('error', (e) => console.error('[window:error]', e.error ?? e.message))
window.addEventListener('unhandledrejection', (e) => console.error('[window:unhandledrejection]', e.reason))

if (import.meta.env.DEV) {
  // 开发调试入口：可在 DevTools 控制台直接操作全局状态
  ;(window as unknown as Record<string, unknown>).__store = useStore
}

// 根级 ErrorBoundary:任一组件渲染抛错只落到兜底 UI,不再卸载整树成永久白屏
ReactDOM.createRoot(document.getElementById('root')!).render(
  <ErrorBoundary label="root">
    <App />
  </ErrorBoundary>
)
