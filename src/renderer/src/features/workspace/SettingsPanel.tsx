// 标题栏最右的设置入口 + 灯箱面板。
//
// 这里收拢那些「偶尔改一次、改完就忘」的东西：主题、提示音。
//
// 位置换过一次：先放在画布右上角，结果和右侧抽屉头部的「添加项目」按钮
// 叠在了一起。标题栏最右是这类全局设置的常规去处，两种视图模式下都在。
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { PhonePanel } from '../phone/PhonePanel'
import { FootprintPanel } from './FootprintPanel'
import { GpuPanel } from './GpuPanel'
import { CliUpdatesPanel } from './CliUpdatesPanel'
import { McpBody } from './McpIndicator'
import { useStore } from '../../store'
import {
  SHORTCUTS,
  formatKeys,
  resolveShortcuts,
  recordKeys,
  keysRejectReason,
  findConflicts
} from '../../../../shared/shortcuts'
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
import './settingsHierarchy.css'
import { SETTINGS_PAGES, findSettingsPages, settingsPage, type SettingsPageKey } from './settingsNavigation'

/** 跟 window.api.prefs 的返回值保持同一个类型来源（preload/index.ts 的 PrefsSnapshot），
 *  不在这再手抄一份形状——那样迟早跟主进程的 Prefs 字段脱节 */
type PrefsState = Awaited<ReturnType<typeof window.api.prefs.get>>

/** 快捷键分区的数据全部来自注册表（src/shared/shortcuts.ts）——
 *  这里不重复列一遍键，否则又是一处会跟代码脱节的手抄。
 *  分组顺序按注册表里第一次出现的先后，不另排。 */
function groupsOf(defs: typeof SHORTCUTS): { group: string; items: typeof SHORTCUTS }[] {
  return [...new Set(defs.map((k) => k.group))].map((group) => ({
    group,
    items: defs.filter((k) => k.group === group)
  }))
}

/** 作用域要显示出来：注册表里有 ⌘T，但它现在只在分屏视图生效 ——
 *  用户在画布下按不出来又在设置里看得见，不说明白就是在骗人。 */
const SCOPE_LABEL: Record<string, string> = {
  global: '任何视图',
  split: '仅分屏视图',
  canvas: '仅画布视图',
  board: '仅看板视图'
}

/** 设置的分区（数量以下面这个数组为准，别在注释里写死 —— 早先写「六个」，
 *  加到第七个之后就一直在骗人）。原来全堆在一个滚动框里，翻到「隐私」要滚过主题、
 *  AI、提示音、更新、画板 —— 找一个开关比想起它叫什么还费劲。改成左侧标签页。 */
type TabKey = SettingsPageKey
function SettingGroup({title, children}: {title:string; children:ReactNode}): JSX.Element {
  return <section className="cset-group"><h3>{title}</h3><div className="cset-card">{children}</div></section>
}
function SettingDetails({title, children}: {title:string; children:ReactNode}): JSX.Element {
  return <details className="cset-details"><summary>{title}</summary><div>{children}</div></details>
}
const SETTINGS_ICON_PATHS = [
 'M4 4h16v16H4z M4 9h16 M9 9v11','M4 4h6v6H4z M14 4h6v6h-6z M4 14h6v6H4z M14 14h6v6h-6z',
 'M9 5L5 9H2v6h3l4 4z M14 8q6 4 0 8','M3 6h18v12H3z M6 10h1m3 0h1m3 0h1m3 0h1M7 14h10',
 'M8 4h8v3h4v12H4V7h4z M8 11h1m6 0h1M9 15h6','M8 3v6m8-6v6M5 9h14v3a7 7 0 01-14 0zM12 19v3',
 'M7 2h10v20H7z M11 18h2','M4 10a8 8 0 0114-5l2 3M20 3v5h-5M20 14a8 8 0 01-14 5l-2-3M4 21v-5h5',
 'M3 16l5-7 4 4 4-9 5 7','M12 2l8 4v7c0 4-8 9-8 9s-8-5-8-9V6z M9 11l2 2 4-4'
]
export function SettingsPanel(): JSX.Element {
  const [open, setOpen] = useState(false)
  // 每次打开都回到「主题」。设置不是工作面板，记住上次停在哪反而让人找不着北 ——
  // 打开发现停在「隐私」，会以为自己点错了地方。
  const [tab, setTab] = useState<TabKey>('theme')
  const [search, setSearch] = useState('')
  const paneRef = useRef<HTMLDivElement>(null)
  const page = settingsPage(tab)
  const matches = findSettingsPages(search)
  useEffect(() => { paneRef.current?.scrollTo(0, 0) }, [tab])
  const isMac = window.api.platform === 'darwin'
  const shortcutOverrides = useStore((s) => s.shortcutOverrides)
  const setShortcutOverride = useStore((s) => s.setShortcutOverride)
  /** 正在录哪一条的新键位。null = 没在录 */
  const [recording, setRecording] = useState<string | null>(null)
  /** 上一次录制被拒的理由，显示在那一行下面 */
  const [keyError, setKeyError] = useState<string | null>(null)
  const shortcutDefs = resolveShortcuts(SHORTCUTS, shortcutOverrides)
  const keyGroups = groupsOf(shortcutDefs)
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
    island: true,
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

  /** 默认 harness 的**硬审批**档位。与上面那条「先问再做」不是一回事：
   *  那条是给 cc/codex 的系统提示（软约定，靠模型自觉），
   *  这条是 omp 进程级的闸 —— 到档位就停下来等你点，模型绕不过去。
   *
   *  **`null` = 还没读到**（面板刚开 / omp 没装）。不要用 `'yolo'` 当初值：
   *  那会让开关在读回来之前先显示成「关着」，用户看到的是一次假状态。 */
  const [omMode, setOmMode] = useState<'always-ask' | 'write' | 'yolo' | null>(null)
  const [omBusy, setOmBusy] = useState(false)
  useEffect(() => {
    // 只在面板真的打开时读 —— 关着的时候读，等于每次挂载都白跑一次 IPC
    if (!open) return
    let alive = true
    void window.api.omp.status().then((st) => {
      if (alive) setOmMode(st?.approvalMode ?? null)
    })
    return () => {
      alive = false
    }
  }, [open])

  async function setApproval(mode: 'always-ask' | 'write' | 'yolo'): Promise<void> {
    setOmBusy(true)
    const prev = omMode
    setOmMode(mode) // 先动，让开关跟手
    const r = await window.api.omp.setApprovalMode(mode)
    if (!r.ok) setOmMode(prev) // 写不进去就退回去，别让界面显示一个没落盘的档位
    setOmBusy(false)
  }

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

  const [diagLines, setDiagLines] = useState<string[] | null>(null)

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
    key: 'autoUpdateCheck' | 'telemetry' | 'clearShapesAfterSnapshot' | 'recentDocsOnly' | 'island',
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

  // 从外部打开并直接落到某个分区。**用自定义事件而不是把状态提到 store** ——
  // 这个面板的开合是纯 UI 的一次性动作，提到全局状态里就多了一份要同步的真相，
  // 而且任何订阅了 store 的组件都会因为「有人打开了设置」白重渲染一次。
  //
  // 调用方：标题栏的 MCP 指示灯（它自己不再弹浮层，点了就跳到 AI 对话那一栏）。
  // 录制态的按键捕获。**capture 阶段**：这时候按的每一个键都属于「录制」，
  // 不能让它顺着冒泡去触发应用自己的快捷键（正在录 ⌘T 的时候不该真的开一个终端）。
  useEffect(() => {
    if (!recording) return
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') {
        setRecording(null)
        setKeyError(null)
        return
      }
      const keys = recordKeys(e, isMac)
      // null = 还只按着修饰键，等下一个键，不算录完
      if (!keys) return
      const def = shortcutDefs.find((d) => d.id === recording)
      if (!def) {
        setRecording(null)
        return
      }
      const reason = keysRejectReason(keys, def.scope)
      if (reason) {
        setKeyError(reason)
        return
      }
      // 冲突按作用域判（同键不同作用域是刻意复用，见 findConflicts 的注释）
      const trial = shortcutDefs.map((d) => (d.id === recording ? { ...d, keys } : d))
      const clash = findConflicts(trial).find((c) => c.ids.includes(recording))
      if (clash) {
        const otherId = clash.ids.find((i) => i !== recording)
        const other = shortcutDefs.find((d) => d.id === otherId)
        setKeyError(`跟「${other?.label ?? otherId}」撞了，那条也在这个作用域里`)
        return
      }
      setShortcutOverride(recording, keys)
      setRecording(null)
      setKeyError(null)
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [recording, shortcutDefs, isMac, setShortcutOverride])

  useEffect(() => {
    const h = (e: Event): void => {
      const t = (e as CustomEvent<{ tab?: TabKey }>).detail?.tab
      setTab(settingsPage(t).key)
      setSearch('')
      setOpen(true)
    }
    window.addEventListener('eas:open-settings', h)
    return () => window.removeEventListener('eas:open-settings', h)
  }, [])

  return (
    <>
      <button
        className="tb-item"
        data-tip="设置"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() => {
          setTab('theme')
          setSearch('')
          setOpen(true)
        }}
      >
        设置
      </button>

      {open &&
        createPortal(
          <div className="cset-overlay" onMouseDown={() => setOpen(false)}>
            <div className="cset-box cset-settings" role="dialog" aria-modal="true" aria-label="设置" onMouseDown={(e) => e.stopPropagation()}>
              <div className="cset-body">
                <aside className="cset-sidebar">
                  <h1>设置</h1>
                  <input className="cset-search" aria-label="搜索设置" placeholder="搜索设置…" value={search} onChange={e=>setSearch(e.target.value)} />
                  <nav className="cset-tabs" aria-label="设置分类">
                    {['工作体验','AI 与连接','系统管理'].map(group=>{
                      const items=matches.filter(t=>t.group===group)
                      return items.length ? <div key={group}><div className="cset-navgroup">{group}</div>{items.map(t=>
                        <button key={t.key} className={`cset-tab${tab===t.key?' on':''}`} aria-current={tab===t.key?'page':undefined} onClick={()=>{setTab(t.key);setRecording(null)}}>
                          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={SETTINGS_ICON_PATHS[SETTINGS_PAGES.findIndex(p=>p.key===t.key)]}/></svg>
                          {t.label}
                        </button>)}</div> : null
                    })}
                    {!matches.length && <p className="cset-note">没有匹配的设置</p>}
                  </nav>
                  <div className="cset-version"><span>Eas-Term</span><span>{window.api.build.version}</span></div>
                </aside>
                <div className="cset-main">
                  <header className="cset-pagehead">
                    <div className="cset-crumb">设置 / {page.group}</div>
                    <h2>{page.label}</h2><p>{page.description}</p>
                    <button className="cset-close" aria-label="关闭设置" onClick={()=>setOpen(false)} data-tip="关闭 (Esc)">✕</button>
                  </header>
                  <div className="cset-pane" ref={paneRef} key={tab}>
              {tab === 'theme' && (
              <SettingGroup title="界面主题">
                <div className="cset-themes">
                  {THEMES.map((t) => (
                    <button
                      key={t.id}
                      className={`cset-theme${t.id === theme ? ' on' : ''}`}
                      onClick={() => setTheme(t.id)}
                    >
                      <span className={`cset-swatch cset-preview-${t.id}`} style={{ background: t.swatch }}><i/><i/></span>
                      <span className="cset-themename">{t.label}</span>
                      {t.id === theme && <CheckIcon size={12} />}
                    </button>
                  ))}
                </div>
              </SettingGroup>
              )}

              {/* 灵动岛开关。**放主题这一栏** —— 它讲的是「界面上出现什么」，
                  跟配色、字号同类，不是某个功能的行为设置。 */}
              {tab === 'theme' && (
                <SettingGroup title="界面元素">
                  <label className="cset-row">
                    <input
                      type="checkbox"
                      checked={prefs.island}
                      onChange={(e) => void setPref('island', e.target.checked)}
                    />
                    <span className="cset-rowname">显示灵动岛</span>
                  </label>
                  <SettingDetails title="灵动岛何时出现？">
                    屏幕顶部那个状态胶囊：有终端在跑、或者有事等你处理时冒出来。
                    <b>你在这个软件里的时候它会自己让位</b>，不占主界面 ——
                    那时候铃铛和抽屉上的提示是同一件事的更好去处。
                    关掉之后那扇窗口根本不建。
                  </SettingDetails>
                </SettingGroup>
              )}

              {tab === 'ai' && (
              <>
              <SettingGroup title="协作方式">
                <label className="cset-row">
                  <input
                    type="checkbox"
                    checked={approvalHook}
                    disabled={hookBusy}
                    onChange={(e) => void toggleApprovalHook(e.target.checked)}
                  />
                  <span className="cset-rowname">
                    先问再做 <span className="cset-badge">提示词约定</span>
                  </span>
                </label>
                <p className="cset-note">修改文件或执行命令前，先说明意图并等待你回复。只读操作照常执行。</p>
                <SettingDetails title="工作方式与限制">
                  {hookBusy
                    ? '处理中…'
                    : approvalHook
                      ? '通过系统提示让模型在改文件/执行命令前先说明打算、等你回一句。不打断进程、不写任何配置文件，只读操作照常直接做。这是软约定——靠模型遵守，不是强制拦截。'
                      : '关着时模型按 CLI 自己的默认权限直接执行，不会先征求同意。'}
                </SettingDetails>
                {hookMsg && <div className="cset-sub">{hookMsg}</div>}

              </SettingGroup>
                {/* 默认 harness 的硬审批。**和上面那条是两种东西**，所以分开写：
                    上面是系统提示（软约定，模型可以不听），这条是进程级的闸。
                    默认关着 —— 用户 2026-09-02：「approvalMode 默认应该是 yolo，
                    审批要用户去点设置。」omp 没装时读不到档位，整段不出现，
                    免得给一个点了不会有任何效果的开关。 */}
                {omMode !== null && (
                  <SettingGroup title="执行权限">
                    <div className="cset-optionhead"><b>OMP 工具审批</b><span className="cset-badge">强制审批</span></div>
                    <p className="cset-note">选择哪些操作必须停下来，由你批准后继续。</p>
                    <div className="cset-approval" role="group" aria-label="OMP 工具审批">
                      {([{value:'yolo',label:'直接执行'},{value:'always-ask',label:'全部审批'},{value:'write',label:'仅命令审批'}] as const).map(mode=>
                        <button key={mode.value} disabled={omBusy} aria-pressed={omMode===mode.value} className={omMode===mode.value?'on':''} onClick={()=>void setApproval(mode.value)}>{mode.label}</button>)}
                    </div>
                    <p className="cset-warning">审批关闭不等于取消安全限制。生成图片、控制浏览器、控制电脑与语音合成仍受既有禁用规则约束。</p>
                    <SettingDetails title="三个档位分别控制什么？">直接执行：工具执行不打断。全部审批：执行前等待批准。仅命令审批：改文件不用批准，只审批执行命令。</SettingDetails>
                  </SettingGroup>
                )}

                {/* 真实额度与准确的上下文占用只在 statusline 那条通道里
                    （2026-08-18 实测：headless 事件流里五小时额度没有百分比，
                    上下文口径也和 /context 不同）。这个开关把一个转发脚本
                    **包在**用户原有 statusline 外面 —— 不替换、可一键还原。 */}
                <SettingGroup title="额度与上下文">
                <label className="cset-row">
                  <input
                    type="checkbox"
                    checked={slOn}
                    disabled={slBusy}
                    onChange={(e) => void toggleStatusline(e.target.checked)}
                  />
                  <span className="cset-rowname">读取订阅额度与上下文占用 <span className="cset-badge">Claude</span></span>
                </label>
                <p className="cset-note">读取 Claude 状态栏；与项目用量账本是不同口径。开启会修改 statusLine，写入前备份，关闭还原。</p>
                <SettingDetails title="配置变更与读取状态">
                  {slBusy
                    ? '处理中…'
                    : slOn
                      ? `已接入。工具栏的仪表盘会显示五小时/本周两条额度进度条，上下文占用与 CLI 里 /context 一致。${
                          slWrapped ? '你原有的状态栏被包在里面、照常工作，关掉即原样还原。' : ''
                        }`
                      : '关着时额度拿不到百分比（CLI 的事件流里五小时那条只有倒计时），上下文占用是估算值、比 /context 偏小。打开会修改 ~/.claude/settings.json 的 statusLine（写前自动备份，且只包一层、不替换你原有的配置）。'}
                </SettingDetails>
                {slMsg && <div className="cset-sub">{slMsg}</div>}
                </SettingGroup>
              </>
              )}

              {/* MCP：AI 通过它动你的画板。独立放 MCP 接入页 ——
                  它讲的是「AI 能对你做什么、做过什么」。
                  标题栏只留了一盏会闪的灯（点它跳到这里），
                  那盏灯不能一起搬走：它存在的理由就是「看得见」。 */}
              {tab === 'mcp' && (
                <SettingGroup title="工具接入与调用记录">
                  <McpBody />
                </SettingGroup>
              )}

              {tab === 'sound' && (
              <SettingGroup title="任务提醒">
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
              </SettingGroup>
              )}

              {tab === 'update' && (
              <>
              <SettingGroup title="Eas-Term">
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
                  <span className="cset-rowname">启动后自动检查 Eas-Term 新版本</span>
                </label>
              </SettingGroup>
              <CliUpdatesPanel />
              </>
              )}

              {tab === 'board' && (
              <SettingGroup title="快照与标记">
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
              </SettingGroup>
              )}

              {tab === 'phone' && <SettingGroup title="连接与配对"><PhonePanel /></SettingGroup>}
              {tab === 'keys' && (
                <div className="cset-sec">
                  <p className="cset-keyintro">
                    点右侧的键位即可改键，Esc 取消。改过的那条会多一个「恢复默认」。
                    默认值在 <code>src/shared/shortcuts.ts</code>，只有改过的存进偏好。
                  </p>
                  {keyGroups.map((g) => (
                    <div className="cset-keygroup" key={g.group}>
                      <div className="cset-keyhead">
                        {g.group}
                        <span className="cset-keyscope">{SCOPE_LABEL[g.items[0].scope] ?? g.items[0].scope}</span>
                      </div>
                      {g.items.map((k) => (
                        <div className="cset-row cset-keyrow" key={k.id}>
                          <span className="cset-rowname">
                            {k.label}
                            {k.note && <em className="cset-keynote">{k.note}</em>}
                            {recording === k.id && keyError && (
                              <em className="cset-keyerr">{keyError}</em>
                            )}
                          </span>
                          <span className="cset-keyactions">
                            {shortcutOverrides[k.id] && recording !== k.id && (
                              <button
                                className="cset-keyreset"
                                onClick={() => setShortcutOverride(k.id, null)}
                                title="恢复默认键位"
                              >
                                恢复默认
                              </button>
                            )}
                            <button
                              className={`cset-kbd cset-kbdbtn${recording === k.id ? ' rec' : ''}`}
                              onClick={() => {
                                setKeyError(null)
                                setRecording(recording === k.id ? null : k.id)
                              }}
                            >
                              {recording === k.id ? '按下新组合… (Esc 取消)' : formatKeys(k.keys, isMac)}
                            </button>
                          </span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}

              {tab === 'perf' && <SettingGroup title="图形加速"><GpuPanel /></SettingGroup>}


              {tab === 'privacy' && (
              <SettingGroup title="匿名使用统计">
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
                  这项匿名统计不采集终端内容、命令、文件路径、项目名、AI 对话或密钥。
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
              </SettingGroup>
              )}

              {/* 扩展能力：这软件在你机器上写过什么，逐个可卸。
                  **放隐私这一栏**是因为它本来就是那份「动了你什么」的总账 ——
                  FootprintPanel 自己的注释写着「这份清单同时是写隐私策略的依据」。
                  2026-08-31 从标题栏搬过来的。 */}
              {tab === 'privacy' && (
                <SettingGroup title="本机扩展与写入">
                  <div className="cset-note">
                    这个软件在你机器上写过的全部位置，可以逐个卸掉。
                  </div>
                  <FootprintPanel mode="inline" />
                </SettingGroup>
              )}
              {tab === 'perf' && (
                <SettingGroup title="诊断日志">
                  <div className="cset-note">
                    界面偶尔闪一下又抓不到瞬间时，这里记着最近发生的事：组件整段卸载重挂、超过 100ms 的长任务、
                    GPU / 渲染进程重启。没有轮询，只有事件发生才写一行。
                  </div>
                  <div className="cset-actions">
                    <button
                      className="cset-btn"
                      onClick={() => void window.api.diag.recent().then((lines) => setDiagLines(lines.slice(-80).reverse()))}
                    >
                      查看最近事件
                    </button>
                    <button className="cset-btn" onClick={() => void window.api.diag.showLog()}>
                      在访达中显示日志
                    </button>
                  </div>
                  {diagLines && (
                    <pre className="cset-pre">{diagLines.length ? diagLines.join('\n') : '（还没有记录）'}</pre>
                  )}
                </SettingGroup>
              )}
                  </div>
                  <footer className="cset-footer">设置按各项即时生效 · 需要确认的操作会单独提示</footer>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  )
}
