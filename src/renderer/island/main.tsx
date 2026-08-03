// 灵动岛窗口的渲染入口。
// 刻意不复用主窗口的 main.tsx：那里要装主题、注册 MCP、挂全局 store。
// 这个窗口只做一件事——把主进程推来的快照画出来。
import ReactDOM from 'react-dom/client'
import { Island } from './Island'
import './island.css'

window.addEventListener('error', (e) => console.error('[island:error]', e.error ?? e.message))

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(<Island />)
