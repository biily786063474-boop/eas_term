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
    const webview = document.createElement('webview')
    webview.className = 'live-page-report-guest'
    webview.setAttribute('partition', 'report-preview')
    webview.setAttribute('src', url)
    const navigate = (event: Event): void => {
      const target = (event as Event & { url?: string }).url
      if (target && !reportNavigationAllowed(target, url)) event.preventDefault()
    }
    const failed = (event: Event): void => {
      const detail = event as Event & { errorCode?: number; errorDescription?: string; isMainFrame?: boolean }
      if (detail.isMainFrame && detail.errorCode !== -3) setError('汇报页无法加载：' + (detail.errorDescription || '文件可能已移动'))
    }
    webview.addEventListener('will-navigate', navigate)
    webview.addEventListener('did-fail-load', failed)
    parent.appendChild(webview)
    let cancelled = false
    const check = async (): Promise<void> => {
      try {
        const path = decodeURIComponent(new URL(url).pathname)
        const result = await window.api.fs.probePaths([path], projectPath)
        if (cancelled) return
        const valid = result[0]?.absPath === path && !result[0]?.isDir
        webview.style.visibility = valid ? 'visible' : 'hidden'
        setError(valid ? '' : '汇报文件已移动或无法访问')
      } catch { if (!cancelled) { webview.style.visibility = 'hidden'; setError('汇报文件无法访问') } }
    }
    void check()
    const timer = window.setInterval(() => void check(), 5000)
    return () => { cancelled = true; window.clearInterval(timer); webview.removeEventListener('will-navigate', navigate); webview.removeEventListener('did-fail-load', failed); webview.remove() }
  }, [url, projectPath])
  return <div ref={host} className="live-page-report-web">{error && <div className="live-page-report-error">{error}<button type="button" onClick={() => { const state = useStore.getState(); state.setViewMode('canvas'); state.focusCanvasNode(frameId, nodeId) }}>在 Frame 中定位</button></div>}</div>
}
