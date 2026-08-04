// 标题栏里的「有新版本」提示，点开是这一版改了什么 + 一键下载。
//
// 没有新版本时整个组件不渲染任何东西 —— 更新提示是那种「一年见几次」的东西，
// 平时不该在标题栏占一格。
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { UpdateInfo } from '../../../../shared/types'
import './workspace.css'

const mb = (n: number): string => (n / 1048576).toFixed(1)

export function UpdateBadge(): JSX.Element | null {
  const [info, setInfo] = useState<UpdateInfo | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [prog, setProg] = useState<{ got: number; total: number } | null>(null)
  /** 组件卸载后就别再 setState 了（下载可能跑几十秒，中途切视图很正常） */
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    // 窗口重载后主进程可能早就查到了，先要一次已知结果，别干等下一轮轮询
    void window.api.update.known().then((i) => alive.current && setInfo(i))
    const offA = window.api.update.onAvailable((i) => alive.current && setInfo(i))
    const offP = window.api.update.onProgress((p) => alive.current && setProg(p))
    return () => {
      alive.current = false
      offA()
      offP()
    }
  }, [])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [open])

  if (!info) return null

  const grab = async (): Promise<void> => {
    setBusy(true)
    setErr(null)
    setProg(null)
    const r = await window.api.update.download()
    if (!alive.current) return
    setBusy(false)
    if (r.ok) setDone(true)
    else setErr(r.error ?? '下载失败')
  }

  const pct = prog?.total ? Math.round((prog.got / prog.total) * 100) : null

  return (
    <>
      <button className="upd-badge" data-tip="有新版本" onClick={() => setOpen(true)}>
        <span className="upd-dot" />
        {info.version}
      </button>
      {open &&
        createPortal(
          <div className="cset-overlay" onMouseDown={() => setOpen(false)}>
            <div className="cset-box upd-box" onMouseDown={(e) => e.stopPropagation()}>
              <div className="cset-head">
                <span className="cset-title">新版本 {info.version}</span>
                <button className="cset-close" onClick={() => setOpen(false)}>
                  ×
                </button>
              </div>

              {info.notes.length > 0 ? (
                <ul className="upd-notes">
                  {info.notes.map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
              ) : (
                <p className="upd-empty">这一版没有附更新说明。</p>
              )}

              {err && <p className="upd-err">{err}</p>}

              {done ? (
                <p className="upd-ok">
                  已下载到「下载」文件夹并打开
                  {window.api.platform === 'darwin'
                    ? '——把 Eas-Term 拖进「应用程序」覆盖旧版，然后重启即可。'
                    : '——按安装程序的提示装完，然后重启即可。'}
                </p>
              ) : (
                <div className="upd-actions">
                  {info.url ? (
                    <button className="upd-go" disabled={busy} onClick={() => void grab()}>
                      {busy
                        ? pct !== null
                          ? `下载中 ${pct}%`
                          : prog
                            ? `下载中 ${mb(prog.got)}MB`
                            : '开始下载…'
                        : '下载并打开'}
                    </button>
                  ) : (
                    <span className="upd-empty">这个平台暂时没有出包</span>
                  )}
                  <button
                    className="upd-later"
                    onClick={() => void window.api.shell.openExternal('https://eas.biily.top/changelog.html')}
                  >
                    看完整更新日志
                  </button>
                </div>
              )}

              {busy && pct !== null && (
                <div className="upd-bar">
                  <i style={{ width: `${pct}%` }} />
                </div>
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  )
}
