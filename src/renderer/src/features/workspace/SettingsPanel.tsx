// 标题栏最右的设置入口 + 灯箱面板。
//
// 这里收拢那些「偶尔改一次、改完就忘」的东西：主题、提示音。
//
// 位置换过一次：先放在画布右上角，结果和右侧抽屉头部的「添加项目」按钮
// 叠在了一起。标题栏最右是这类全局设置的常规去处，两种视图模式下都在。
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
import './workspace.css'

/** 跟 window.api.prefs 的返回值保持同一个类型来源（preload/index.ts 的 PrefsSnapshot），
 *  不在这再手抄一份形状——那样迟早跟主进程的 Prefs 字段脱节 */
type PrefsState = Awaited<ReturnType<typeof window.api.prefs.get>>

export function SettingsPanel(): JSX.Element {
  const [open, setOpen] = useState(false)
  const theme = useStore((s) => s.theme)
  const setTheme = useStore((s) => s.setTheme)
  // 音效设置存在 localStorage（不进 store：它不影响任何渲染逻辑，
  // 只有这个面板和播放器读它，放进全局状态是徒增一份要同步的副本）
  const [soundOn, setSoundOn] = useState(isSoundEnabled)
  const [vol, setVol] = useState(getVolume)
  // 更新检查、匿名统计、画板行为这几个开关存在**主进程**（见 main/prefs.ts）：
  // 有的在窗口出现之前就要生效，有的要主进程独立维护状态，放渲染层的 localStorage 来不及
  const [prefs, setPrefs] = useState<PrefsState>({
    autoUpdateCheck: true,
    telemetry: true,
    recentDocsOnly: false
  })
  const [checking, setChecking] = useState(false)
  const [checkMsg, setCheckMsg] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    void window.api.prefs.get().then(setPrefs)
  }, [open])

  const setPref = async (
    key: 'autoUpdateCheck' | 'telemetry' | 'clearShapesAfterSnapshot' | 'recentDocsOnly',
    value: boolean | 'keep' | 'clear' | undefined
  ): Promise<void> => {
    setPrefs(await window.api.prefs.set(key, value))
    // 关掉自动检查要立刻停掉轮询，不能等下次重启
    if (key === 'autoUpdateCheck') void window.api.update.reschedule()
    // 关掉统计要把已经攒着的计数丢掉——那是用户没同意上报的数据
    if (key === 'telemetry') window.api.telemetry.refresh()
  }

  const check = async (): Promise<void> => {
    setChecking(true)
    setCheckMsg(null)
    const r = await window.api.update.check()
    setChecking(false)
    if (!r.ok) setCheckMsg(`检查失败：${r.error}`)
    else if (r.info) setCheckMsg(`有新版本 ${r.info.version}，看标题栏上的提示`)
    else setCheckMsg('已经是最新版本')
  }

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

              <div className="cset-sec">
                <div className="cset-label">更新</div>
                <div className="cset-row">
                  <span className="cset-rowname">
                    当前版本 {window.api.build.version}
                    {window.api.build.packaged ? '' : '（开发构建）'}
                  </span>
                  <button className="cset-trybtn" disabled={checking} onClick={() => void check()}>
                    {checking ? '检查中…' : '检查更新'}
                  </button>
                </div>
                {checkMsg && <div className="cset-sub">{checkMsg}</div>}
                <label className="cset-row">
                  <input
                    type="checkbox"
                    checked={prefs.autoUpdateCheck}
                    onChange={(e) => void setPref('autoUpdateCheck', e.target.checked)}
                  />
                  <span className="cset-rowname">启动后自动检查新版本</span>
                </label>
              </div>

              <div className="cset-sec">
                <div className="cset-label">画板</div>
                <div className="cset-row">
                  <span className="cset-rowname">快照后清空标记</span>
                  <select
                    value={prefs.clearShapesAfterSnapshot ?? 'ask'}
                    onChange={(e) =>
                      void setPref(
                        'clearShapesAfterSnapshot',
                        e.target.value === 'ask' ? undefined : (e.target.value as 'keep' | 'clear')
                      )
                    }
                  >
                    <option value="ask">每次询问</option>
                    <option value="keep">总是保留</option>
                    <option value="clear">总是清空</option>
                  </select>
                </div>
              </div>

              <div className="cset-sec">
                <div className="cset-label">隐私</div>
                <label className="cset-row">
                  <input
                    type="checkbox"
                    checked={prefs.telemetry}
                    onChange={(e) => void setPref('telemetry', e.target.checked)}
                  />
                  <span className="cset-rowname">发送匿名使用统计，帮助改进</span>
                </label>
                {/* 把「采了什么、没采什么」直接写在开关下面。
                    只放一个隐私页链接的话，几乎没人会点过去看 */}
                <div className="cset-sub">
                  只有使用时长、启动次数、版本与系统大类、各功能的使用次数。
                  <br />
                  终端内容、命令、文件路径、项目名、与 AI 的对话、密钥 —— 一个字节都不会离开这台电脑。
                  <br />
                  <a
                    className="cset-link"
                    href="#"
                    onClick={(e) => {
                      e.preventDefault()
                      void window.api.shell.openExternal('https://eas.biily.top/privacy.html')
                    }}
                  >
                    完整隐私说明
                  </a>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  )
}
