// 灵动岛窗口的渲染入口。
// 刻意不复用主窗口的 main.tsx：那里要装主题、注册 MCP、挂全局 store。
// 这个窗口只做一件事——把主进程推来的快照画出来。
import ReactDOM from 'react-dom/client'
import { Island } from './Island'
import { IslandErrorBoundary } from './IslandErrorBoundary'
import './island.css'

window.addEventListener('error', (e) => console.error('[island:error]', e.error ?? e.message))
// 主窗口的 main.tsx 两个都接了，这里只接了 error 一个——不是有意为之，是漏了。
// 灵动岛这边没有异步操作看似用不上，但 window.island.action 之类的 IPC 调用、
// 以后任何人加一个 await，都可能产生一个没人 catch 的 rejection，静默丢失。
window.addEventListener('unhandledrejection', (e) =>
  console.error('[island:unhandledrejection]', e.reason)
)

// Chromium 对 file:// + crossorigin 的 <link rel=stylesheet> 有个不直观的行为：加载失败时
// 既不会让主进程的 did-fail-load 响（那是"帧导航"事件，管不到子资源），也不会在 console
// 打一条"Failed to load resource"——crossorigin 触发的 CORS 保护让"文件不存在"和
// "文件存在但跨域不让读"这两种情况对 JS 几乎不可区分（link.sheet 两种情况下都不是 null，
// 读 cssRules 反而两种情况都抛 SecurityError）。实测确认过（task-23 报告）：唯一靠得住的
// 信号是自己重新 fetch 一遍同一个 URL——CSP 的 connect-src 'self' 允许这么做，fetch
// 的失败/404 不会被那层 CORS 不透明性掩盖。这正是用户反馈过的"灵动岛只剩一行没样式的
// 裸文字"最可能对应的失败模式，前面 did-fail-load/console-message 那套接不住这一种。
document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]').forEach((link) => {
  fetch(link.href)
    .then((res) => {
      if (!res.ok) console.error('[island] stylesheet-load-failed', link.href, res.status)
    })
    .catch((err) => console.error('[island] stylesheet-load-failed', link.href, String(err)))
})

// 根级错误边界：main 窗口有（main.tsx 的 ErrorBoundary），灵动岛之前没有——
// <Island/> 渲染期间任何一次未捕获异常，React 18 的默认行为是把整棵树卸载成空，
// 表现就是"窗口还在、但里面什么都没有"。见 IslandErrorBoundary.tsx 顶部注释，
// 为什么不能直接复用主窗口那份。
ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <IslandErrorBoundary>
    <Island />
  </IslandErrorBoundary>
)
