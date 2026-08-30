// 标题栏最右的设置入口 + 灯箱面板。
//
// 这里收拢那些「偶尔改一次、改完就忘」的东西：主题、提示音。
//
// 位置换过一次：先放在画布右上角，结果和右侧抽屉头部的「添加项目」按钮
// 叠在了一起。标题栏最右是这类全局设置的常规去处，两种视图模式下都在。
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { PhonePanel } from '../phone/PhonePanel'
import { GpuPanel } from './GpuPanel'
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

/** 设置的六个分区。原来全堆在一个滚动框里，翻到「隐私」要滚过主题、AI、提示音、
 *  更新、画板 —— 找一个开关比想起它叫什么还费劲。改成左侧标签页。 */
const TABS = [
  { key: 'theme', label: '主题' },
  { key: 'ai', label: 'AI 对话' },
  { key: 'sound', label: '提示音' },
  { key: 'update', label: '更新' },
  { key: 'board', label: '画板' },
  { key: 'phone', label: '手机端' },
  { key: 'perf', label: '性能' },
  { key: 'privacy', label: '隐私' }
] as const
type TabKey = (typeof TABS)[number]['key']

export function SettingsPanel(): JSX.Element {
  const [open, setOpen] = useState(false)
  // 每次打开都回到「主题」。设置不是工作面板，记住上次停在哪反而让人找不着北 ——
  // 打开发现停在「隐私」，会以为自己点错了地方。
  const [tab, setTab] = useState<TabKey>('theme')
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
  // 「先问再做」开关。**现在走的是伪无头那条路**（系统提示，见 ASK_FIRST_PROMPT），
  // 不再往用户项目里装 PreToolUse hook。
  // 关掉时那段卸载逻辑**保留着**：更早的版本真的装过 hook，那些文件还在用户仓库里，
  // 这是唯一能清掉它们的入口。装过才有得卸，没装过就是一句「没有项目装过」。
  const approvalHook = useStore((s) => s.agentApprovalHook)
  const setApprovalHook = useStore((s) => s.setAgentApprovalHook)
  const [hookBusy, setHookBusy] = useState(false)
  const [hookMsg, setHookMsg] = useState<string | null>(null)

  // statusline 转发器（真实额度 + 与 /context 一致的上下文占用）
  const [slOn, setSlOn] = useState(false)
  const [slWrapped, setSlWrapped] = useState(false)
  const [slBusy, setSlBusy] = useState(false)
  const [slMsg, setSlMsg] = useState<string | null>(null)
  useEffect(() => {
    void window.api.statusline.status().then((r) => {
      setSlOn(r.installed)
      setSlWrapped(!!r.wrapped)
    })
  }, [])
  const toggleStatusline = async (on: boolean): Promise<void> => {
    setSlBusy(true)
    setSlMsg(null)
    try {
      const r = on ? await window.api.statusline.install() : await window.api.statusline.uninstall()
      if (!r.ok) {
        setSlMsg('操作失败，配置没有被改动')
        return
      }
      const st = await window.api.statusline.status()
      setSlOn(st.installed)
      setSlWrapped(!!st.wrapped)
      // 状态栏是 Claude Code 每次刷新时才跑的，改完要等它下一次刷新才生效
      setSlMsg(r.changed ? '已生效（正在跑的 CLI 会话要下一次刷新状态栏才读到）' : r.reason)
    } finally {
      setSlBusy(false)
    }
  }

  const toggleApprovalHook = async (on: boolean): Promise<void> => {
    setHookMsg(null)
    // 开：只改意愿。新会话起来时会把「先问再做」附进系统提示，不写任何文件
    if (on) {
      setApprovalHook(true)
      return
    }
    // 关：顺带清掉**旧版本**装进各项目的 PreToolUse hook。
    // 现在这条路不装 hook 了，但那些文件还躺在用户仓库里，留着照样每次拦截，
    // 而界面上再没有别的地方能卸它 —— 这是唯一的清理入口。
    setApprovalHook(false)
    const projects = useStore.getState().projects
    if (!projects.length) return
    setHookBusy(true)
    let n = 0
    for (const p of projects) {
      try {
        const r = await window.api.agentChat.hookUninstall(p.path)
        if (r?.ok) n += 1
      } catch {
        // 单个项目卸不掉不该中断整轮（可能是目录已经不在了）
      }
    }
    setHookBusy(false)
    setHookMsg(n > 0 ? `已从 ${n} 个项目卸掉审批钩子` : '没有项目装过审批钩子')
  }

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
        className="tb-item"
        data-tip="设置"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() => {
          setTab('theme')
          setOpen(true)
        }}
      >
        设置
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

              <div className="cset-body">
                <nav className="cset-tabs">
                  {TABS.map((t) => (
                    <button
                      key={t.key}
                      className={`cset-tab${tab === t.key ? ' on' : ''}`}
                      onClick={() => setTab(t.key)}
                    >
                      {t.label}
                    </button>
                  ))}
                </nav>
                <div className="cset-pane">
              {tab === 'theme' && (
              <div className="cset-sec">
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
              )}

              {tab === 'ai' && (
              <div className="cset-sec">
                <label className="cset-row">
                  <input
                    type="checkbox"
                    checked={approvalHook}
                    disabled={hookBusy}
                    onChange={(e) => void toggleApprovalHook(e.target.checked)}
                  />
                  <span className="cset-rowname">
                    先问再做：动手前先说明意图，等你回复
                  </span>
                </label>
                <div className="cset-sub">
                  {hookBusy
                    ? '处理中…'
                    : approvalHook
                      ? '通过系统提示让模型在改文件/执行命令前先说明打算、等你回一句。不打断进程、不写任何配置文件，只读操作照常直接做。这是软约定——靠模型遵守，不是强制拦截。'
                      : '关着时模型按 CLI 自己的默认权限直接执行，不会先征求同意。'}
                </div>
                {hookMsg && <div className="cset-sub">{hookMsg}</div>}

                {/* 真实额度与准确的上下文占用只在 statusline 那条通道里
                    （2026-08-18 实测：headless 事件流里五小时额度没有百分比，
                    上下文口径也和 /context 不同）。这个开关把一个转发脚本
                    **包在**用户原有 statusline 外面 —— 不替换、可一键还原。 */}
                <label className="cset-row">
                  <input
                    type="checkbox"
                    checked={slOn}
                    disabled={slBusy}
                    onChange={(e) => void toggleStatusline(e.target.checked)}
                  />
                  <span className="cset-rowname">读取订阅额度与上下文占用</span>
                </label>
                <div className="cset-sub">
                  {slBusy
                    ? '处理中…'
                    : slOn
                      ? `已接入。工具栏的仪表盘会显示五小时/本周两条额度进度条，上下文占用与 CLI 里 /context 一致。${
                          slWrapped ? '你原有的状态栏被包在里面、照常工作，关掉即原样还原。' : ''
                        }`
                      : '关着时额度拿不到百分比（CLI 的事件流里五小时那条只有倒计时），上下文占用是估算值、比 /context 偏小。打开会修改 ~/.claude/settings.json 的 statusLine（写前自动备份，且只包一层、不替换你原有的配置）。'}
                </div>
                {slMsg && <div className="cset-sub">{slMsg}</div>}
              </div>
              )}

              {tab === 'sound' && (
              <div className="cset-sec">
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
              )}

              {tab === 'update' && (
              <div className="cset-sec">
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
              )}

              {tab === 'board' && (
              <div className="cset-sec">
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
              )}

              {tab === 'phone' && <PhonePanel />}
              {tab === 'perf' && <GpuPanel />}


              {tab === 'privacy' && (
              <div className="cset-sec">
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
              )}
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  )
}
