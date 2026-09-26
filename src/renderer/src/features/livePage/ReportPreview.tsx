import { useEffect, useRef, useState } from 'react'
import { reportNavigationAllowed } from './reportPreviewPolicy'
import { useStore } from '../../store'
import { retainReportPreview } from './reportAssociation'

export function ReportPreview({ url, frameId, nodeId, projectPath }: { url: string; frameId: string; nodeId: string; projectPath: string }): JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const [error, setError] = useState('')
  useEffect(() => retainReportPreview(frameId, nodeId), [frameId, nodeId])
  useEffect(() => {
    const parent = host.current
    if (!parent) return
    let webview: Electron.WebviewTag | null = null
    let cancelled = false
    let checking = false
    let authorizedUrl = ''
    const navigate = (event: Event): void => {
      const target = (event as Event & { url?: string }).url
      if (target && !reportNavigationAllowed(target, authorizedUrl)) event.preventDefault()
    }
    const failed = (event: Event): void => {
      const detail = event as Event & { errorCode?: number; errorDescription?: string; isMainFrame?: boolean }
      if (detail.isMainFrame && detail.errorCode !== -3) setError('汇报页无法加载：' + (detail.errorDescription || '文件可能已移动'))
    }
    const removeGuest = (): void => {
      if (!webview) return
      webview.removeEventListener('will-navigate', navigate)
      webview.removeEventListener('did-fail-load', failed)
      webview.remove()
      webview = null
    }
    const check = async (): Promise<void> => {
      if (checking) return
      checking = true
      try {
        const result = projectPath ? await window.api.fs.validateReport(url, projectPath) : { ok: false }
        if (cancelled) return
        const valid = result.ok && !!result.url
        if (valid && !webview) {
          // 先完成项目授权/存在性复核，再创建 guest；失效时立即销毁，不只隐藏。
          webview = document.createElement('webview') as Electron.WebviewTag
          webview.className = 'live-page-report-guest'
          webview.setAttribute('partition', 'report-preview')
          webview.addEventListener('will-navigate', navigate)
          webview.addEventListener('did-fail-load', failed)
          authorizedUrl = result.url!
          webview.setAttribute('src', authorizedUrl)
          parent.appendChild(webview)
        } else if (!valid || (webview && result.url !== authorizedUrl)) removeGuest()
        setError(valid ? '' : '汇报文件已移动或无法访问')
      } catch { if (!cancelled) { removeGuest(); setError('汇报文件无法访问') } }
      finally { checking = false }
    }
    void check()
    const timer = window.setInterval(() => void check(), 5000)
    return () => { cancelled = true; window.clearInterval(timer); removeGuest() }
  }, [url, projectPath])
  return <div ref={host} className="live-page-report-web">{error && <div className="live-page-report-error">{error}<button type="button" onClick={() => { const state = useStore.getState(); state.setViewMode('canvas'); state.focusCanvasNode(frameId, nodeId) }}>在 Frame 中定位</button></div>}</div>
}
