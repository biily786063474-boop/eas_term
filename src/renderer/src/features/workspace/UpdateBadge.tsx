// 标题栏里的「有新版本」提示，点开是这一版改了什么 + 一键下载。
//
// 没有新版本时整个组件不渲染任何东西 —— 更新提示是那种「一年见几次」的东西，
// 平时不该在标题栏占一格。
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useT, getLang } from '../../i18n.ts'
import type { UpdateInfo } from '../../../../shared/types'
import './workspace.css'

const mb = (n: number): string => (n / 1048576).toFixed(1)

export function UpdateBadge(): JSX.Element | null {
  const tr = useT()
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
    else setErr(r.error ?? tr('settings.update.downloadFailed'))
  }

  const pct = prog?.total ? Math.round((prog.got / prog.total) * 100) : null

  return (
    <>
      <button className="upd-badge" data-tip={tr('settings.update.badgeTip')} onClick={() => setOpen(true)}>
        <span className="upd-dot" />
        {info.version}
      </button>
      {open &&
        createPortal(
          <div className="cset-overlay" onMouseDown={() => setOpen(false)}>
            <div className="cset-box upd-box" onMouseDown={(e) => e.stopPropagation()}>
              <div className="cset-head">
                <span className="cset-title">{tr('settings.update.newVersionTitle', { version: info.version })}</span>
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
                <p className="upd-empty">{tr('settings.update.noNotes')}</p>
              )}

              {err && <p className="upd-err">{err}</p>}

              {done ? (
                <p className="upd-ok">
                  {window.api.platform === 'darwin'
                    ? tr('settings.update.doneMac')
                    : tr('settings.update.doneOther')}
                </p>
              ) : (
                <div className="upd-actions">
                  {info.url ? (
                    <button className="upd-go" disabled={busy} onClick={() => void grab()}>
                      {busy
                        ? pct !== null
                          ? tr('settings.update.downloadingPct', { pct })
                          : prog
                            ? tr('settings.update.downloadingMb', { mb: mb(prog.got) })
                            : tr('settings.update.starting')
                        : tr('settings.update.downloadOpen')}
                    </button>
                  ) : (
                    <span className="upd-empty">{tr('settings.update.noPackage')}</span>
                  )}
                  <button
                    className="upd-later"
                    onClick={() => void window.api.shell.openExternal(`https://eas.biily.top/${getLang() === 'en' ? 'en/' : ''}changelog.html`)}
                  >
                    {tr('settings.update.changelog')}
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
