import { useEffect, useRef, useState } from 'react'
import { CubeIcon } from '../../ui/Icons'
import { MODEL_VIEWER_SIZE } from '../../../../shared/modelViewerDep'

// 画布 3D 模型节点（.glb）。查看器 model-viewer 不进主包：未下载先给下载闸，下好后在一个
// 裸 <webview> 里加载 easmodel://view/<glb>（独立进程/CSP，主渲染层 CSP 不动）。
// 设计见 docs/superpowers/specs/2026-09-16-3d-model-preview-design.md。

// base64url(绝对路径)，同 easfileUrl 的编码
function b64url(p: string): string {
  return btoa(unescape(encodeURIComponent(p))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

type Phase = 'checking' | 'need-download' | 'downloading' | 'ready' | 'error'

export function Canvas3DViewer({ filePath }: { filePath: string }): JSX.Element {
  const [phase, setPhase] = useState<Phase>('checking')
  const [pct, setPct] = useState(0)
  const [err, setErr] = useState('')
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let alive = true
    window.api.modelDep.status().then((s) => { if (alive) setPhase(s.installed ? 'ready' : 'need-download') })
    return () => { alive = false }
  }, [])

  const startDownload = (): void => {
    setPhase('downloading'); setPct(0); setErr('')
    const off = window.api.modelDep.onDownloadProgress((p) => {
      if (p.phase === 'downloading' && p.total) setPct(Math.min(100, Math.round(((p.received ?? 0) / p.total) * 100)))
      else if (p.phase === 'error') { setErr(p.error ?? '下载失败'); setPhase('error') }
    })
    void window.api.modelDep.download().then((r) => {
      off()
      if (r.ok) setPhase('ready')
      else { setErr(r.error ?? '下载失败'); setPhase('error') }
    })
  }

  // ready 时挂一个裸 webview（命令式创建，避开 JSX 自定义元素类型坑，同 WebView.tsx）
  useEffect(() => {
    if (phase !== 'ready') return
    const host = hostRef.current
    if (!host) return
    const wv = document.createElement('webview')
    wv.className = 'model-frame'
    // 不设 partition：用默认 session，easmodel 的 protocol handler 注册在默认 session 上；
    // 换独立 partition 会让 model-viewer 取 .glb 的 fetch 失败。webview 已被主进程加固
    // （无 preload / 无 nodeIntegration / sandbox），内容只有 easmodel://，共享默认 session 无碍。
    wv.setAttribute('src', `easmodel://m/viewer/${b64url(filePath)}`)
    const onFail = (e: Event): void => {
      const ev = e as unknown as { errorCode?: number; errorDescription?: string; isMainFrame?: boolean }
      if (ev.isMainFrame !== false && ev.errorCode !== -3) { setErr(`查看器加载失败：${ev.errorDescription ?? ev.errorCode}`); setPhase('error') }
    }
    const onMsg = (e: Event): void => {
      const ev = e as unknown as { level?: number; message?: string }
      if ((ev.level ?? 0) >= 3) console.error('[model webview]', ev.message)
    }
    wv.addEventListener('did-fail-load', onFail)
    wv.addEventListener('console-message', onMsg)
    host.appendChild(wv)
    return () => {
      wv.removeEventListener('did-fail-load', onFail)
      wv.removeEventListener('console-message', onMsg)
      wv.remove()
    }
  }, [phase, filePath])

  if (phase === 'ready') return <div className="model-host" ref={hostRef} />

  return (
    <div className="model-gate">
      <CubeIcon size={30} />
      <div className="model-name">{filePath.split('/').pop()}</div>
      {phase === 'checking' && <div className="model-hint">检查查看器…</div>}
      {phase === 'need-download' && (
        <>
          <div className="model-hint">
            这是 3D 模型。首次查看需下载查看器（约 {(MODEL_VIEWER_SIZE / 1024 / 1024).toFixed(1)}MB），只需一次，之后离线可用。
          </div>
          <button className="model-dl-btn" onClick={startDownload}>下载查看器</button>
        </>
      )}
      {phase === 'downloading' && (
        <>
          <div className="model-hint">下载查看器… {pct}%</div>
          <div className="model-bar"><div className="model-bar-fill" style={{ width: pct + '%' }} /></div>
        </>
      )}
      {phase === 'error' && (
        <>
          <div className="model-hint model-err">{err}</div>
          <button className="model-dl-btn" onClick={startDownload}>重试</button>
        </>
      )}
    </div>
  )
}
