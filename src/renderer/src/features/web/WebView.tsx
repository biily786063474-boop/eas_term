// 画布迷你浏览器：用 Electron <webview>（Chromium 内核、独立进程、有完整导航能力）。
// 关键：webview 是 DOM 元素(OOPIF)，会跟随画布的 CSS transform 缩放平移——这正是相对
// WebContentsView(原生叠加层、不跟 transform)的决定性优势。iframe 太弱(X-Frame-Options 挡站、无 chrome)。
// 需主进程 webPreferences.webviewTag:true。<webview> 用命令式创建(避开 React/TS 的自定义元素类型坑，
// 且部分属性必须在 attach 前 setAttribute)。

import { useEffect, useRef, useState } from 'react'
import { ChevronLeftIcon, ChevronRightIcon, RefreshIcon, CloseIcon, GlobeIcon } from '../../ui/Icons'
import './web.css'

// <webview> 元素最小接口（只列我们用到的方法）
interface WebviewEl extends HTMLElement {
  loadURL(url: string): Promise<void>
  getURL(): string
  reload(): void
  stop(): void
  goBack(): void
  goForward(): void
  canGoBack(): boolean
  canGoForward(): boolean
}

// 地址归一化：有协议头/file:// 直接用；像域名(含点、无空格)补 https://；否则当搜索词
function normalizeUrl(raw: string): string {
  const u = raw.trim()
  if (!u) return ''
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(u) || u.startsWith('about:')) return u
  if (/^[^\s]+\.[^\s]+$/.test(u)) return 'https://' + u
  return 'https://www.google.com/search?q=' + encodeURIComponent(u)
}

export function WebView({ url: initialUrl }: { url: string | null }): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const wvRef = useRef<WebviewEl | null>(null)
  const [addr, setAddr] = useState(initialUrl ?? '') // 地址栏输入
  const [loading, setLoading] = useState(false)
  const [canBack, setCanBack] = useState(false)
  const [canFwd, setCanFwd] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const wv = document.createElement('webview') as unknown as WebviewEl
    wv.className = 'web-frame'
    // 多个浏览器节点共享会话(cookie/登录)、并与主应用隔离
    wv.setAttribute('partition', 'persist:browser')
    wv.setAttribute('allowpopups', 'true')
    if (initialUrl) wv.setAttribute('src', initialUrl)
    host.appendChild(wv)
    wvRef.current = wv

    const syncNav = (): void => {
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
      if (url) setAddr(url)
      syncNav()
    }
    const onNavInPage = (e: Event): void => {
      const ev = e as unknown as { url?: string; isMainFrame?: boolean }
      if (ev.isMainFrame && ev.url) setAddr(ev.url)
    }
    const onFail = (e: Event): void => {
      const ev = e as unknown as { errorCode?: number; errorDescription?: string; isMainFrame?: boolean }
      // -3 = ABORTED(用户/重定向打断)，不算错误
      if (ev.isMainFrame && ev.errorCode !== -3) setError(ev.errorDescription || '页面加载失败')
    }
    wv.addEventListener('did-start-loading', onStart)
    wv.addEventListener('did-stop-loading', onStop)
    wv.addEventListener('did-navigate', onNav)
    wv.addEventListener('did-navigate-in-page', onNavInPage)
    wv.addEventListener('did-fail-load', onFail)

    return () => {
      wv.removeEventListener('did-start-loading', onStart)
      wv.removeEventListener('did-stop-loading', onStop)
      wv.removeEventListener('did-navigate', onNav)
      wv.removeEventListener('did-navigate-in-page', onNavInPage)
      wv.removeEventListener('did-fail-load', onFail)
      wv.remove()
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
    // dom-ready 前 loadURL 会抛 → 回退到设 src(初始导航同样生效)
    try {
      void wv.loadURL(u)
    } catch {
      wv.setAttribute('src', u)
    }
  }

  return (
    <div className="web-view">
      <div className="web-bar">
        <button
          className="web-nav"
          data-tip="后退"
          disabled={!canBack}
          onClick={() => wvRef.current?.goBack()}
        >
          <ChevronLeftIcon size={14} />
        </button>
        <button
          className="web-nav"
          data-tip="前进"
          disabled={!canFwd}
          onClick={() => wvRef.current?.goForward()}
        >
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
          <GlobeIcon size={11} />
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
      </div>
    </div>
  )
}
