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
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { CheckIcon, TerminalIcon } from '../../ui/Icons'
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

export function CliSetupPanel(props: {
  cliId: 'claude' | 'codex'
  displayName: string
  /** 要执行的安装命令。**由调用方给** —— AI 对话那侧用 CliInfo.installCmd，
   *  首启引导那侧用用户在「官方脚本 / brew / npm」里选的那条。
   *  这一层不挑也不拼命令：拼命令的地方只有 agentInstall.ts 一处。
   *  没有就只能引导去官网。 */
  installCmd?: string
  /** 从哪一步开始。'install' = 没装；'login' = 装了但没登录 */
  from: 'install' | 'login'
  onDone: (status: CliAuthStatus | null) => void
  onCancel: () => void
}): React.JSX.Element {
  const { cliId, displayName, installCmd, from, onDone, onCancel } = props
  const [step, setStep] = useState<Step>(from === 'login' ? { k: 'login' } : { k: 'confirm' })
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
    const off = window.api.cliAuth.onInstall((s: InstallState) => {
      if (!aliveRef.current || s.cli !== cliId) return
      if (s.phase === 'failed') {
        setStep({ k: 'failed', error: s.error || '安装没能完成', output: s.output ?? [] })
        return
      }
      if (s.phase === 'done') {
        // **装完不停在「装好了」** —— 直接进登录，那才是「能用了」
        setStep({ k: 'login' })
        return
      }
      setStep({ k: 'installing', state: s })
    })
    return () => {
      aliveRef.current = false
      off()
    }
  }, [cliId])

  // Esc 关掉。**装的过程中不响应** —— 同点遮罩那条：
  // 一下误触取消掉跑了两分钟的安装，代价太大
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      if (stepRef.current.k === 'installing') return
      e.stopPropagation()
      onCancelRef.current()
    }
    // 捕获阶段：画布那侧也听 Esc（退出最大化），不抢在前面的话两个会一起响应
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  const begin = (): void => {
    if (!installCmd) return
    setStep({ k: 'installing', state: { cli: cliId, phase: 'running', step: '正在准备…' } })
    void window.api.cliAuth.startInstall(cliId, installCmd).then((r) => {
      if (!aliveRef.current || r.ok) return
      setStep({ k: 'failed', error: r.error || '起不来安装进程', output: [] })
    })
  }

  const close = (): void => {
    // 装到一半关掉 = 取消安装。留着它在后台跑完，用户既看不到进度也不知道成没成
    if (step.k === 'installing') void window.api.cliAuth.cancelInstall()
    onCancel()
  }

  const termCmd = TERMINAL_LOGIN[cliId]

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
      <div className="ac-setup" onMouseDown={(e) => e.stopPropagation()}>
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
          <button type="button" className="ac-login-x" onClick={close} aria-label="取消">
            ×
          </button>
        </span>
      </div>

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
                <button type="button" className="ac-login-go ac-setup-primary" onClick={begin}>
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
          <div className="ac-setup-step">
            {step.state.phase === 'verifying' ? '装好了，正在核实…' : step.state.step || '正在安装…'}
          </div>
          <div className="ac-login-hint">这一步可能要几分钟，取决于你的网络。</div>
        </>
      )}

      {/* ── 失败：把输出给他看 ───────────────────────────────────── */}
      {step.k === 'failed' && (
        <>
          <div className="ac-login-err ac-setup-err">{step.error}</div>
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
      {step.k === 'login' && (
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
  return createPortal(body, document.body)
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
