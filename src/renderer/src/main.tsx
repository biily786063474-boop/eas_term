import ReactDOM from 'react-dom/client'
import { App } from './App'
import { useStore } from './store'
import { applyTheme, loadTheme } from './themes'
import './styles.css'

// 渲染前先套用持久化的主题，避免首帧闪默认色
applyTheme(loadTheme())

if (import.meta.env.DEV) {
  // 开发调试入口：可在 DevTools 控制台直接操作全局状态
  ;(window as unknown as Record<string, unknown>).__store = useStore
}

ReactDOM.createRoot(document.getElementById('root')!).render(<App />)
