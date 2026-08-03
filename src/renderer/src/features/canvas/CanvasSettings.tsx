// 画布右上角的设置入口 + 灯箱面板。
//
// 这里收拢那些「偶尔改一次、改完就忘」的东西：主题、提示音。
// 它们原本散在标题栏（主题）和无处安放（提示音），标题栏那点地方
// 每加一个图标就挤一分，而这类设置一个月也点不了两次，不该常驻在最贵的位置。
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../../store'
import { THEMES } from '../../themes'
import { CheckIcon } from '../../ui/Icons'
import {
  getVolume,
  isSoundEnabled,
  previewNotice,
  setSoundEnabled,
  setVolume
} from '../notify/sound'

export function CanvasSettings(): JSX.Element {
  const [open, setOpen] = useState(false)
  const theme = useStore((s) => s.theme)
  const setTheme = useStore((s) => s.setTheme)
  // 音效设置存在 localStorage（不进 store：它不影响任何渲染逻辑，
  // 只有这个面板和播放器读它，放进全局状态是徒增一份要同步的副本）
  const [soundOn, setSoundOn] = useState(isSoundEnabled)
  const [vol, setVol] = useState(getVolume)

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

  return (
    <>
      <button
        className="cset-btn"
        data-tip="设置"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() => setOpen(true)}
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.2.5.66.87 1.2 1H21a2 2 0 1 1 0 4h-.09c-.54.13-1 .5-1.2 1z" />
        </svg>
      </button>

      {open &&
        createPortal(
          <div className="cset-overlay" onMouseDown={() => setOpen(false)}>
            <div className="cset-box" onMouseDown={(e) => e.stopPropagation()}>
              <div className="cset-head">
                <span className="cset-title">设置</span>
                <button className="cset-close" onClick={() => setOpen(false)} data-tip="关闭 (Esc)">
                  ✕
                </button>
              </div>

              <div className="cset-sec">
                <div className="cset-label">主题</div>
                <div className="cset-themes">
                  {THEMES.map((t) => (
                    <button
                      key={t.id}
                      className={`cset-theme${t.id === theme ? ' on' : ''}`}
                      onClick={() => setTheme(t.id)}
                    >
                      <span className="cset-swatch" style={{ background: t.swatch }} />
                      <span className="cset-themename">{t.label}</span>
                      {t.id === theme && <CheckIcon size={12} />}
                    </button>
                  ))}
                </div>
              </div>

              <div className="cset-sec">
                <div className="cset-label">提示音</div>
                <label className="cset-row">
                  <input
                    type="checkbox"
                    checked={soundOn}
                    onChange={(e) => {
                      setSoundOn(e.target.checked)
                      setSoundEnabled(e.target.checked)
                      // 打开的瞬间响一下，让人知道它是什么声音
                      if (e.target.checked) previewNotice('done')
                    }}
                  />
                  <span className="cset-rowname">有任务完成 / 等待审批时播放提示音</span>
                </label>

                <div className={`cset-sub${soundOn ? '' : ' off'}`}>
                  <label className="cset-row">
                    <span className="cset-rowname">音量</span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={Math.round(vol * 100)}
                      disabled={!soundOn}
                      onChange={(e) => {
                        const v = Number(e.target.value) / 100
                        setVol(v)
                        setVolume(v)
                      }}
                      // 松手时试听一次，不然拖滑块听不出调到多大了
                      onMouseUp={() => soundOn && previewNotice('done')}
                    />
                    <span className="cset-volnum">{Math.round(vol * 100)}%</span>
                  </label>
                  <div className="cset-try">
                    <span className="cset-rowname">试听</span>
                    <button
                      className="cset-trybtn"
                      disabled={!soundOn}
                      onClick={() => previewNotice('done')}
                    >
                      任务完成
                    </button>
                    <button
                      className="cset-trybtn"
                      disabled={!soundOn}
                      onClick={() => previewNotice('approval')}
                    >
                      等待审批
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  )
}
