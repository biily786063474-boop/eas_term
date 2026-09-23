// 「装 → 登录」这条首次设置链路的容器。**全程 GUI，不开终端。**
//
// 用户 2026-08-29 的原话：「用户在 AI 对话模式下的安装行为也不要去显示终端，
// 要用安装进度条以及 cli 首次安装成功的某些选项以 GUI 的形式引导用户完成初次的设置链路」。
//
// ── 为什么装和登录要串在一个组件里 ──────────────────────────────────
// 因为对用户来说它们是**一件事**：「让这个 CLI 能用」。
// 拆成两个各自弹一次的面板，等于让人在同一条路上被拦两次 ——
// 装完弹一个「装好了」，关掉，再撞一次「还没登录」，再点一次。
// 串起来之后，装完自动接上登录，用户只做一次决定。
//
// ── 进度条为什么不显示百分比 ────────────────────────────────────────
// curl|bash 和 npm 都不给可解析的进度。硬凑一个数字是在骗人 ——
// 卡在 87% 半分钟比没有进度条更让人焦虑。
// 这里用**不确定态的动画条 + 安装器自己最后打出来的那行字**：
// 动画表示「还在动」，那行字是真的，也正是想看的东西。
//
// ── 失败时必须能看到输出 ────────────────────────────────────────────
// 这是终端那条路唯一不可替代的地方（agentInstall.ts 顶上第三条理由）：
// 公司网络 / 代理 / 权限失败时，一句「安装失败」什么忙也帮不上。
// 换成进度条就得把它补回来 —— 所以失败时展开输出尾部，并留一条「填进终端」的退路。
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'

import { CheckIcon, TerminalIcon } from '../../ui/Icons'
import { restoreInstallSnapshot } from '../../../../shared/cliInstallPolicy'
import { installFeedback } from '../../../../shared/cliInstallFeedback'
import { installActivity } from '../../../../shared/cliInstallActivity'
import { SetupSnake } from './SetupSnake'
import { CliLoginPanel } from './CliLoginPanel'
import { useStore } from '../../store'
import type { CliAuthStatus, InstallState } from '../../../../shared/types'

/** GUI 走不通时，在终端里登录用的命令。
 *
 *  **和主进程 cliAuth/index.ts 的 LOGIN_ARGS 是同一套命令**（那边跑的就是这两条）。
 *  两处各写一份必然分叉 —— 但这里没法 import 那个模块（它引 electron，
 *  渲染层加载不了），所以退而求其次：写死在这里，并在两边都留一句互指的注释。
 *
 *  为什么需要这条兜底：GUI 这条路会被我们控制不了的东西挡住 ——
 *  出口 IP 的地区限制、公司代理、浏览器打不开。那时候「全程 GUI」这条原则
 *  不该变成「那你就没法用了」。默认仍然是 GUI，这只是走不通时的出口。 */
const TERMINAL_LOGIN: Record<'claude' | 'codex', string> = {
  claude: 'claude auth login --claudeai',
  codex: 'codex login'
}

type Step =
  /** 还没动手，摆着命令等用户点「开始安装」。**命令必须看得见** */
  | { k: 'confirm' }
  | { k: 'installing'; state: InstallState }
  | { k: 'failed'; error: string; output: string[] }
  /** 装好了，接着登录 —— 同一条链路，不让用户再点一次 */
  | { k: 'login' }
  | { k: 'ready'; status: CliAuthStatus | null }

export type CliSetupProps = {
  cliId: 'claude' | 'codex'
  displayName: string
  /** 要执行的安装命令。**由调用方给** —— AI 对话那侧用 CliInfo.installCmd，
   *  首启引导那侧用用户在「官方脚本 / brew / npm」里选的那条。
   *  这一层不挑也不拼命令：拼命令的地方只有 agentInstall.ts 一处。
   *  没有就只能引导去官网。 */
  installCmd?: string
  /** 进来就开装，不停在「摆着命令等你点」那一屏。
   *  **只有在用户已经明确表达过「装」的入口上才给 true**（空造梦空间那三颗按钮）。 */
  autoStart?: boolean
  /** 从哪一步开始。'install' = 没装；'login' = 装了但没登录 */
  from: 'install' | 'login'
  onDone: (status: CliAuthStatus | null) => void
  onCancel: () => void
}
let currentSetup: CliSetupProps | null = null
const setupListeners = new Set<() => void>()
const subscribeSetup = (fn: () => void): (() => void) => { setupListeners.add(fn); return () => { setupListeners.delete(fn) } }
function publishSetup(): void { for (const fn of setupListeners) fn() }
export function CliSetupPanel(props: CliSetupProps): null {
  useEffect(() => {
    // Window-owned: unmounting the originating pane must not cancel or hide the task.
    if (!currentSetup) { currentSetup = props; publishSetup() }
    else { props.onCancel() } // Consume reused/rejected caller so its next click mounts a fresh request.
    window.dispatchEvent(new CustomEvent('eas:reopen-cli-setup', { detail: props.cliId }))
  }, [props.cliId])
  return null
}
export function CliSetupHost(): React.JSX.Element | null {
  const request = useSyncExternalStore(subscribeSetup, () => currentSetup, () => null)
  if (!request) return null
  const release = (): void => { currentSetup = null; publishSetup() }
  return <CliSetupDialog key={request.cliId} {...request}
    onCancel={() => { release(); request.onCancel() }}
    onDone={(status) => { release(); request.onDone(status) }} />
}
function CliSetupDialog(props: CliSetupProps): React.JSX.Element {
  const { cliId, displayName, installCmd, autoStart, from, onDone, onCancel } = props
  const [loginApproved, setLoginApproved] = useState(false)
  const [minimized, setMinimized] = useState(false)
  const [gameOpen, setGameOpen] = useState(false)
  const gameOpenRef = useRef(gameOpen); gameOpenRef.current = gameOpen
  const [hydrated, setHydrated] = useState(false)
  const [now, setNow] = useState(Date.now())
  const [actionError, setActionError] = useState('')
  const [installChoice, setInstallChoice] = useState(installCmd ?? '')
  const [options, setOptions] = useState<{via:string;cmd:string}[]>([])
  const [step, setStep] = useState<Step>(from === 'login' ? { k: 'login' } : { k: 'confirm' })

  // ── 「点了安装就直接装」──────────────────────────────────────────────────
  //
  // 用户 2026-09-02：「所有的安装都要在 UI 里面完成，不要让用户看到不该看到的
  // 开发者相关的东西。**用户点击安装之后就直接安装完成。**」
  //
  // `confirm` 那一屏把 `curl … | bash` 摆出来等用户再点一次「开始安装」。
  // 从空造梦空间那三颗按钮进来时，他点的那颗底下就写着「点一下装好」——
  // **那一下就是他的确认**，再拦一次是让人在同一条路上被问两遍，
  // 而且摆出来的那行命令正是他说的「不该看到的开发者相关的东西」。
  //
  // ⚠️ **只在 `autoStart` 时跳过。** 别把 `confirm` 整个删掉：
  // 它跑的是**远程脚本以用户权限执行**（图纸 01 把这条列为全仓风险最高的出站），
  // 从别的入口（没有明确表达过「装」的地方）进来时，那一屏仍然是必要的知情环节。
  const started = useRef(false)
  useEffect(() => {
    if (!hydrated || !autoStart || started.current) return
    if (step.k !== 'confirm' || !installCmd) return
    started.current = true
    begin()
  }, [autoStart, step.k, installCmd, hydrated])
  const aliveRef = useRef(true)
  const doneRef = useRef(onDone)
  doneRef.current = onDone
  // 给上面那个 Esc 监听读当前值用 —— 它只挂一次，闭包捕获的是首帧的值
  const stepRef = useRef(step)
  stepRef.current = step
  const onCancelRef = useRef(onCancel)
  onCancelRef.current = onCancel
  const prefillTerminal = useStore((s) => s.prefillTerminal)
  /** 问号展开了没。**默认收着** —— 它是兜底，不该在正常路径上占版面 */
  const [helpOpen, setHelpOpen] = useState(false)

  useEffect(() => {
    aliveRef.current = true
    let eventSeen = false
    const apply = (s: InstallState): void => {
      if (!aliveRef.current || s.cli !== cliId) return
      if (['failed', 'done', 'canceled'].includes(s.phase)) { setMinimized(false); setGameOpen(false) }
      if (s.phase === 'failed' || s.phase === 'canceled') {
        setStep({ k: 'failed', error: s.error || '安装未完成', output: s.output ?? [] }); return
      }
      if (s.phase === 'done') { setLoginApproved(false); setStep({ k: 'login' }); return }
      setStep({ k: 'installing', state: s })
    }
    const off = window.api.cliAuth.onInstall((s) => { if(s.cli === cliId) { eventSeen = true; apply(s) } })
    void window.api.cliAuth.installSnapshot(cliId).then(async (s) => {
      if (!aliveRef.current) return
      if (s && !eventSeen) {
        const installed = s.phase === 'done' && from === 'install' ? (await window.api.cliAuth.check(cliId)).installed : true
        if (!aliveRef.current) return
        if (!eventSeen && restoreInstallSnapshot(s.phase, from, installed)) { started.current = true; apply(s) }
      }
      setHydrated(true)
    }).catch(() => { if(aliveRef.current) { setActionError('无法读取安装任务，请关闭后重试；未启动新安装。'); setHydrated(false) } })
    void window.api.skill.installPlan().then(p => { if(aliveRef.current) setOptions(p[cliId].options) }).catch(() => {})
    return () => {
      aliveRef.current = false
      off()
    }
  }, [cliId])

  // Esc 关掉。**装的过程中不响应** —— 同点遮罩那条：
  // 一下误触取消掉跑了两分钟的安装，代价太大
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (gameOpenRef.current || minimized) return
      if (e.key === 'Tab') {
        const panel = document.querySelector<HTMLElement>('.ac-setup')
        const nodes = Array.from(panel?.querySelectorAll<HTMLElement>('button:not(:disabled), input, select, summary, a[href]') ?? [])
        const first=nodes[0], last=nodes.at(-1)
        if (!panel?.contains(document.activeElement) || (!e.shiftKey && document.activeElement === last)) { e.preventDefault(); first?.focus() }
        else if (e.shiftKey && (document.activeElement === first || document.activeElement === panel)) { e.preventDefault(); last?.focus() }
        return
      }
      if (e.key !== 'Escape') return
      if (stepRef.current.k === 'installing') { e.preventDefault(); e.stopImmediatePropagation(); setGameOpen(false); setMinimized(true); return }
      e.stopPropagation()
      onCancelRef.current()
    }
    // 捕获阶段：画布那侧也听 Esc（退出最大化），不抢在前面的话两个会一起响应
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [minimized])

  useEffect(() => { if(!minimized) document.querySelector<HTMLElement>('.ac-setup')?.focus() }, [minimized])

  const begin = (): void => {
    if (!installChoice || !hydrated) return
    setActionError('')
    setStep({ k: 'installing', state: { cli: cliId, phase: 'running', step: '正在准备…', startedAt: Date.now(), updatedAt: Date.now() } })
    void window.api.cliAuth.startInstall(cliId, installChoice).then((r) => {
      if (!aliveRef.current || r.ok) return
      setStep({ k: 'failed', error: r.error || '起不来安装进程', output: [] })
    }).catch((error: unknown) => { if(aliveRef.current) setStep({ k:'failed', error: '启动安装失败：'+String(error), output:[] }) })
  }

  const close = (): void => {
    // 装到一半关掉 = 取消安装。留着它在后台跑完，用户既看不到进度也不知道成没成
    if (step.k === 'installing') { setMinimized(true); setGameOpen(false); return }
    onCancel()
  }

  useEffect(() => {
    const reopen = (event: Event): void => { setMinimized(false); if ((event as CustomEvent).detail !== cliId) setActionError('已有 '+displayName+' 设置任务，请先完成或关闭当前任务，再设置其他助手。') }
    window.addEventListener('eas:reopen-cli-setup', reopen)
    return () => window.removeEventListener('eas:reopen-cli-setup', reopen)
  }, [])
  useEffect(() => {
    if (step.k !== 'installing') return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [step.k])
  const cancelTask = (): void => {
    setGameOpen(false)
    void window.api.cliAuth.cancelInstall(cliId, step.k === 'installing' ? step.state.taskId : undefined).then(r => { if(!r.ok) setActionError('这不是当前窗口拥有的任务，或任务已变化；未执行取消。') }).catch(() => setActionError('取消请求未送达，安装可能仍在进行，请重试。'))
  }
  if (minimized) return createPortal(<div className="ac-install-mini" role="status">
    <strong>{displayName} · {step.k === 'installing' ? '安装进行中' : '等待继续设置'}</strong>
    <p>安装结束后自动展开，不会自动登录或发送消息。</p>
    <button onClick={() => setMinimized(false)}>查看进度</button>
  </div>, document.body)

  const termCmd = TERMINAL_LOGIN[cliId]
  const activity = step.k === 'installing' ? installActivity(step.state, now) : null

  // **灯箱，不是内嵌。** 原来它长在对话框空态里 —— 画布上的节点常常只有三四百像素高，
  // 面板一展开就把输入框和历史全挤没了，网址那一长串还要在里面横向滚。
  // 登录是一件「做完就走」的事，配得上一个自己的层。
  const body = (
    <div
      className="ac-setup-mask"
      onMouseDown={(e) => {
        // **装的过程中点遮罩不关。** 那一下会取消一个跑了两分钟的安装，
        // 而点空白处通常是无意的。要放弃就点右上角那个 ×（那是明确动作）
        if (e.target === e.currentTarget && step.k !== 'installing') close()
      }}
    >
      <div className="ac-setup" tabIndex={-1} role="dialog" aria-modal={!gameOpen} aria-label={displayName + " 设置"} ref={node => { if(node) node.inert = gameOpen }} onMouseDown={(e) => e.stopPropagation()}>
      <div className="ac-login-head">
        <span className="ac-login-title">
          {step.k === 'login' ? `登录 ${displayName}` : `安装 ${displayName}`}
        </span>
        <span className="ac-setup-head-r">
          {/* **GUI 走不通时的出口。** hover 说清楚怎么办，点开给命令和一键填进终端。
              默认仍然是 GUI —— 这颗问号平时只是个 12px 的小图标，不抢戏。 */}
          <button
            type="button"
            className="ac-setup-help"
            aria-label="登录不了怎么办"
            aria-expanded={helpOpen}
            onClick={() => setHelpOpen((v) => !v)}
            data-tip={`登录不了？\n\n出口 IP 的地区限制、公司代理、浏览器打不开 —— 这些我们挡不住。\n遇到这些情况可以改在终端里登录：\n\n${termCmd}\n\n点这个问号展开，可以一键把命令填进终端。\n登录完回到这里，状态会自动刷新。`}
          >
            ?
          </button>
          <button type="button" className="ac-login-x" onClick={close} aria-label={step.k === 'installing' ? '最小化' : '关闭'}>
            {step.k === 'installing' ? '−' : '×'}
          </button>
        </span>
      </div>

      {actionError && <p role="alert" className="ac-login-err">{actionError}</p>}
      {/* 展开态：把 hover 里说的那些变成能点的。
          hover 只能看不能复制，而命令是要拿去用的 */}
      {helpOpen && (
        <div className="ac-setup-help-box">
          <div className="ac-setup-help-t">GUI 登录走不通时</div>
          <div className="ac-setup-help-d">
            地区限制、公司代理、浏览器打不开都会挡住上面这条路 —— 那些不在我们能控制的范围里。
            这种时候改在终端里登录，走的是同一个账号、同一套凭证，
            <b>登录完回到这里状态会自动刷新</b>。
          </div>
          <div className="ac-setup-cmd">{termCmd}</div>
          <div className="ac-setup-row">
            <button
              type="button"
              className="ac-login-retry"
              onClick={() => {
                void prefillTerminal(termCmd, { run: true })
                onCancel()
              }}
            >
              <TerminalIcon size={11} /> 开个终端跑这条
            </button>
            <button
              type="button"
              className="ac-login-retry"
              onClick={() => void window.api.clipboard.writeText(termCmd)}
            >
              复制命令
            </button>
          </div>
        </div>
      )}

      {/* ── 第一步：让他看清要执行什么 ───────────────────────────────
          **命令原文必须摆出来。** 后台代跑的前提是用户看得见自己同意了什么 ——
          这是它跟「静默装全局 CLI」的唯一区别，不能省。 */}
      {step.k === 'confirm' && (
        <>
          <div className="ac-setup-say">
            这台电脑上还没有 <b>{displayName}</b>。装好之后就能在这里对话了。
          </div>
          {installCmd ? (
            <>
              <div className="ac-setup-cmd-l">会执行这条命令</div>
              <div className="ac-setup-cmd">{installCmd}</div>
              <div className="ac-setup-row">
                <button type="button" className="ac-login-go ac-setup-primary" onClick={begin} disabled={!hydrated}>
                  开始安装
                </button>
                {/* 退路：不想让我们代跑的人，可以拿去自己在终端里执行 */}
                <button
                  type="button"
                  className="ac-login-retry"
                  onClick={() => {
                    void prefillTerminal(installCmd as string)
                    onCancel()
                  }}
                >
                  我自己在终端装
                </button>
              </div>
            </>
          ) : (
            <div className="ac-login-step">这个 CLI 要到它的官网安装，我们没法代劳。</div>
          )}
        </>
      )}

      {/* ── 第二步：进度 ─────────────────────────────────────────── */}
      {step.k === 'installing' && (
        <>
          <div className="ac-setup-bar" role="progressbar" aria-label="正在安装">
            <span className="ac-setup-bar-run" />
          </div>
          <div className="ac-setup-stage"><span className="ac-setup-stage-dot" />{activity?.stage}</div>
          <div className="ac-setup-activity" aria-label="最近安装动态" aria-live="polite">
            {activity?.recent.length ? activity.recent.map((line, index) => <div key={`${index}-${line}`} className="ac-setup-activity-line">{line}</div>) : <div className="ac-setup-activity-empty">{step.state.phase === 'verifying' ? '正在检查程序能否正常启动…' : '等待安装器的第一条输出…'}</div>}
          </div>
          <div className="ac-login-hint">已等待 {Math.max(0, Math.floor((now - (step.state.startedAt ?? now)) / 1000))} 秒 · 不显示估算百分比</div>
          {activity?.stalled && <p className="ac-login-hint">距上次安装器输出 {activity.secondsSinceOutput} 秒；可能在下载或等待网络，可继续等待或取消。</p>}
          {!!step.state.output?.length && <details className="ac-setup-log"><summary>查看详细输出（最近 {step.state.output.length} 行）</summary><pre className="ac-setup-out">{step.state.output.join('\n')}</pre></details>}
          <div className="ac-setup-row">
            <button className="ac-login-retry" onClick={() => setMinimized(true)}>最小化，完成后提醒我</button>
            <button className="ac-login-retry" onClick={() => setGameOpen(true)} disabled={step.state.phase === 'stopping'}>贪吃蛇</button>
            <button className="ac-login-retry" onClick={cancelTask}>{step.state.phase === 'stopping' ? '再次停止' : '取消安装'}</button>
          </div>
        </>
      )}

      {/* ── 失败：把输出给他看 ───────────────────────────────────── */}
      {step.k === 'failed' && (
        <>
          <div className="ac-login-err ac-setup-err" role="alert">{step.error === '安装已停止' ? '安装已取消' : installFeedback(step.error, step.output).title}</div>
          <p className="ac-login-hint">{installFeedback(step.error, step.output).advice}</p>
          <details><summary>查看诊断详情</summary><pre className="ac-setup-out">{step.error}</pre></details>
          {options.length > 1 && <label className="ac-login-hint">重试的安装方式<select value={installChoice} onChange={e => setInstallChoice(e.target.value)}>{options.map(o => <option key={o.cmd} value={o.cmd}>{o.via}</option>)}</select></label>}
          {step.output.length > 0 && (
            <>
              <div className="ac-setup-cmd-l">安装器最后说的话</div>
              <pre className="ac-setup-out">{step.output.join('\n')}</pre>
            </>
          )}
          <div className="ac-setup-row">
            {/* **没有命令就不给这颗按钮** —— begin() 会直接 return，
                留一个点了没反应的按钮比没有按钮更糟 */}
            {installCmd && (
              <button type="button" className="ac-login-retry" onClick={begin}>
                再试一次
              </button>
            )}
            {/* **保住终端那条退路。** 代理 / 权限这类问题，在终端里自己动手才解得开 */}
            {installCmd && (
              <button
                type="button"
                className="ac-login-retry"
                onClick={() => {
                  void prefillTerminal(installCmd as string)
                  onCancel()
                }}
              >
                把命令填进终端，我自己来
              </button>
            )}
          </div>
        </>
      )}

      {/* ── 第三步：登录。复用同一个面板，不另做一套 ───────────────── */}
      {step.k === 'login' && !loginApproved && <><p className="ac-setup-say">{displayName} 安装已完成，接下来登录你的账号。</p><button className="ac-login-go" onClick={() => setLoginApproved(true)}>登录并继续</button><p className="ac-login-hint">不会自动发送草稿。</p></>}
      {step.k === 'login' && hydrated && loginApproved && (
        <CliLoginPanel
          cli={cliId}
          displayName={displayName}
          bare
          onCancel={onCancel}
          onDone={(status) => {
            setStep({ k: 'ready', status })
            doneRef.current(status)
          }}
        />
      )}

      {step.k === 'ready' && (
        <div className="ac-login-ok">
          <CheckIcon size={13} />
          {displayName} 已经可以用了{step.status?.account ? ` · ${step.status.account}` : ''}
        </div>
      )}
      </div>
    </div>
  )
  // portal 到 body：它原来长在画布节点里，被节点的 overflow 和层级裁着。
  // 灯箱要盖住整个窗口，就不能待在那棵子树里
  return <>{createPortal(body, document.body)}{gameOpen && step.k === 'installing' && <SetupSnake onClose={() => setGameOpen(false)} />}</>
}

/** 首启引导里那一行「某个 CLI 的状态」。抽出来是因为引导页和空态都要用同一套措辞 */
export function CliStateLabel(props: { installed: boolean; loggedIn: boolean | null }): React.JSX.Element {
  const { installed, loggedIn } = props
  if (!installed) return <span className="ac-ob-tag">未安装</span>
  // **null 是「读不到」，不是「没登录」** —— 说成没登录会把人推去做无用的重新登录
  if (loggedIn === null) return <span className="ac-ob-tag">已安装 · 状态读不到</span>
  if (!loggedIn) return <span className="ac-ob-tag warn">已安装 · 未登录</span>
  return (
    <span className="ac-ob-tag ok">
      <CheckIcon size={10} /> 可以用了
    </span>
  )
}
