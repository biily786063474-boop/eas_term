// 画布迷你浏览器：用 Electron <webview>（Chromium 内核、独立进程、有完整导航能力）。
// 关键：webview 是 DOM 元素(OOPIF)，会跟随画布的 CSS transform 缩放平移——这正是相对
// WebContentsView(原生叠加层、不跟 transform)的决定性优势。iframe 太弱(X-Frame-Options 挡站、无 chrome)。
// 需主进程 webPreferences.webviewTag:true。<webview> 用命令式创建(避开 React/TS 的自定义元素类型坑，
// 且部分属性必须在 attach 前 setAttribute)。

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../../store'
import { ChevronLeftIcon, ChevronRightIcon, RefreshIcon, CloseIcon, GlobeIcon } from '../../ui/Icons'
import './web.css'

// <webview> 元素最小接口（只列我们用到的方法）
interface WebviewEl extends HTMLElement {
  loadURL(url: string): Promise<void>
  getURL(): string
  getWebContentsId(): number
  reload(): void
  stop(): void
  goBack(): void
  goForward(): void
  canGoBack(): boolean
  canGoForward(): boolean
  openDevTools(): void
}

// guestId → 聚焦该浏览器节点的回调。主进程拦截「链接开新窗」后按 guest webContents id 通知，
// 我们据此把画布 pan 到对应浏览器节点。模块级单例监听，多个浏览器节点共享。
const focusRegistry = new Map<number, () => void>()
let focusBound = false
function ensureFocusListener(): void {
  if (focusBound) return
  focusBound = true
  window.api.browser.onFocus((guestId) => focusRegistry.get(guestId)?.())
}

// 地址归一化：有协议头/file:// 直接用；像域名(含点、无空格)补 https://；否则当搜索词
function normalizeUrl(raw: string): string {
  const u = raw.trim()
  if (!u) return ''
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(u) || u.startsWith('about:')) return u
  if (/^[^\s]+\.[^\s]+$/.test(u)) return 'https://' + u
  return 'https://www.google.com/search?q=' + encodeURIComponent(u)
}

export function WebView({
  url: initialUrl,
  frameId,
  nodeId,
  selected
}: {
  url: string | null
  /** 画布 web 节点的归属（用于导航回写 url 持久化 + 链接开新窗时聚焦过去）；分屏无 */
  frameId?: string
  nodeId?: string
  /** 画布中该节点是否被选中：未选中时盖透明遮罩，双指手势冒泡给画布 pan（不进网页内部滚动） */
  selected?: boolean
}): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const wvRef = useRef<WebviewEl | null>(null)
  const [addr, setAddr] = useState(initialUrl ?? '') // 地址栏输入
  const [favicon, setFavicon] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [canBack, setCanBack] = useState(false)
  const [canFwd, setCanFwd] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [menu, setMenu] = useState<DOMRect | null>(null) // ⋯ 溢出菜单锚点

  // 菜单外部点击 / Esc 关闭
  useEffect(() => {
    if (!menu) return
    const close = (): void => setMenu(null)
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [menu])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    ensureFocusListener()
    let wv: WebviewEl | null = null
    let guestId = -1

    const syncNav = (): void => {
      if (!wv) return
      try {
        setCanBack(wv.canGoBack())
        setCanFwd(wv.canGoForward())
      } catch {
        /* dom-ready 前调用会抛，忽略 */
      }
    }
    const onStart = (): void => {
      setLoading(true)
      setError(null)
    }
    const onStop = (): void => {
      setLoading(false)
      syncNav()
    }
    const onNav = (e: Event): void => {
      const url = (e as unknown as { url?: string }).url
      if (url) {
        setAddr(url)
        // 回写节点 url → 随 canvas.json 持久化，重开还原到上次页面
        if (frameId && nodeId) useStore.getState().setNodeUrl(frameId, nodeId, url)
      }
      syncNav()
    }
    const onNavInPage = (e: Event): void => {
      const ev = e as unknown as { url?: string; isMainFrame?: boolean }
      if (ev.isMainFrame && ev.url) setAddr(ev.url)
    }
    const onFail = (e: Event): void => {
      const ev = e as unknown as { errorCode?: number; errorDescription?: string; isMainFrame?: boolean }
      if (ev.isMainFrame && ev.errorCode !== -3) setError(ev.errorDescription || '页面加载失败')
    }
    const onFavicon = (e: Event): void => {
      const favs = (e as unknown as { favicons?: string[] }).favicons
      setFavicon(favs && favs.length ? favs[0] : null)
    }
    const onTitle = (e: Event): void => {
      // 页面标题回写节点(存 pane.title；节点头部手动 name 优先，其次标题)
      const t = (e as unknown as { title?: string }).title
      if (t && frameId && nodeId) useStore.getState().setWebNodeTitle(frameId, nodeId, t)
    }
    const onDomReady = (): void => {
      if (!wv) return
      guestId = wv.getWebContentsId()
      // 注册聚焦回调：主进程拦到链接开新窗 → 通知 → 把画布平移到本浏览器节点
      focusRegistry.set(guestId, () => {
        if (frameId && nodeId) useStore.getState().focusCanvasNode(frameId, nodeId)
      })
    }

    // 懒挂载：节点首次进入视口才创建 webview。离屏的浏览器节点（如恢复一堆书签）不建 Chromium 进程，省内存。
    const create = (): void => {
      if (wv) return
      wv = document.createElement('webview') as unknown as WebviewEl
      wv.className = 'web-frame'
      wv.setAttribute('partition', 'persist:browser') // 多浏览器节点共享会话，与主应用隔离
      // 允许 window.open/target=_blank 触达主进程 setWindowOpenHandler（否则被禁、拦不成同 view 导航）
      wv.setAttribute('allowpopups', 'true')
      if (initialUrl) wv.setAttribute('src', initialUrl)
      host.appendChild(wv)
      wvRef.current = wv
      wv.addEventListener('did-start-loading', onStart)
      wv.addEventListener('did-stop-loading', onStop)
      wv.addEventListener('did-navigate', onNav)
      wv.addEventListener('did-navigate-in-page', onNavInPage)
      wv.addEventListener('did-fail-load', onFail)
      wv.addEventListener('page-favicon-updated', onFavicon)
      wv.addEventListener('page-title-updated', onTitle)
      wv.addEventListener('dom-ready', onDomReady)
    }

    const io = new IntersectionObserver(
      (ents) => {
        if (ents.some((e) => e.isIntersecting)) {
          create()
          io.disconnect()
        }
      },
      { threshold: 0.01 }
    )
    io.observe(host)

    return () => {
      io.disconnect()
      if (wv) {
        wv.removeEventListener('did-start-loading', onStart)
        wv.removeEventListener('did-stop-loading', onStop)
        wv.removeEventListener('did-navigate', onNav)
        wv.removeEventListener('did-navigate-in-page', onNavInPage)
        wv.removeEventListener('did-fail-load', onFail)
        wv.removeEventListener('page-favicon-updated', onFavicon)
        wv.removeEventListener('page-title-updated', onTitle)
        wv.removeEventListener('dom-ready', onDomReady)
        if (guestId >= 0) focusRegistry.delete(guestId)
        wv.remove()
      }
      wvRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const go = (raw: string): void => {
    const u = normalizeUrl(raw)
    if (!u) return
    const wv = wvRef.current
    if (!wv) return
    setError(null)
    setAddr(u)
    // dom-ready 前 loadURL 会抛 → 回退到设 src（初始导航同样生效）
    try {
      void wv.loadURL(u)
    } catch {
      wv.setAttribute('src', u)
    }
  }

  return (
    <div className="web-view">
      <div className="web-bar">
        <button className="web-nav" data-tip="后退" disabled={!canBack} onClick={() => wvRef.current?.goBack()}>
          <ChevronLeftIcon size={14} />
        </button>
        <button className="web-nav" data-tip="前进" disabled={!canFwd} onClick={() => wvRef.current?.goForward()}>
          <ChevronRightIcon size={14} />
        </button>
        <button
          className="web-nav"
          data-tip={loading ? '停止' : '刷新'}
          onClick={() => (loading ? wvRef.current?.stop() : wvRef.current?.reload())}
        >
          {loading ? <CloseIcon size={12} /> : <RefreshIcon size={12} />}
        </button>
        <div className="web-addr">
          {favicon ? (
            <img className="web-fav" src={favicon} alt="" onError={() => setFavicon(null)} />
          ) : (
            <GlobeIcon size={11} />
          )}
          <input
            value={addr}
            spellCheck={false}
            placeholder="输入网址或搜索…"
            onChange={(e) => setAddr(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') go((e.target as HTMLInputElement).value)
            }}
          />
          {loading && <span className="web-spin" />}
        </div>
        <button
          className="web-nav web-more"
          data-tip="更多"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => setMenu(menu ? null : e.currentTarget.getBoundingClientRect())}
        >
          ⋯
        </button>
      </div>
      <div className="web-body" ref={hostRef}>
        {!initialUrl && !addr && (
          <div className="web-empty">
            <GlobeIcon size={22} />
            <span>输入网址开始浏览</span>
          </div>
        )}
        {error && (
          <div className="web-error">
            <div className="web-error-t">打不开这个页面</div>
            <div className="web-error-d">{error}</div>
            <button onClick={() => wvRef.current?.reload()}>重试</button>
          </div>
        )}
        {/* 未选中：透明遮罩盖住 webview，双指手势打在遮罩上 → 冒泡给画布 pan；点击经节点捕获选中。
            选中(true)/分屏(undefined) 不盖，网页正常内部滚动与交互。 */}
        {selected === false && <div className="web-shield" />}
      </div>
      {menu &&
        createPortal(
          <div
            className="context-menu"
            style={{ left: Math.max(8, menu.right - 176), top: menu.bottom + 4 }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => {
                const u = wvRef.current?.getURL()
                if (u) void window.api.clipboard.writeText(u)
                setMenu(null)
              }}
            >
              复制网址
            </button>
            <button
              onClick={() => {
                const u = wvRef.current?.getURL()
                if (u) void window.api.shell.openExternal(u)
                setMenu(null)
              }}
            >
              用系统浏览器打开
            </button>
            <div className="menu-sep" />
            <button
              onClick={() => {
                wvRef.current?.openDevTools()
                setMenu(null)
              }}
            >
              开发者工具
            </button>
          </div>,
          document.body
        )}
    </div>
  )
}
