// AI 对话里的登录面板。**整条登录链路都在这儿，不碰终端。**
//
// 用户 2026-08-29 的原话：「不能让用户在终端模式下登陆，需要全部是 AI 对话模块的
// GUI」。所以哪怕 CLI 自己的提示是「Please run /login」（claude 未登录时的真实输出），
// 也不能把那句话端给用户 —— 那是让人回终端敲命令。
//
// ── 为什么不自动跳浏览器 ────────────────────────────────────────────
// 用户原话：「不要直接跳网页，而是加一个点我去登陆的按钮，这个按钮用户可以右键
// 复制登陆链接，去自己信任的浏览器访问这个网址」。
//
// 于是这里的分工是：
// · 主进程用一个 no-op 的 `open` 垫在 PATH 最前面，**掐掉 CLI 自己弹浏览器**
//   （见 cliAuth/index.ts 的 noopOpenDir）
// · 界面把拿到的网址摆成一个按钮：**左键**才打开浏览器，**右键**复制链接
// 「跳不跳」从此是用户按出来的，不是 CLI 替他决定的。
//
// ── 一进来就把登录进程拉起来 ────────────────────────────────────────
// 面板只在用户明确要登录时才挂载（点了「点我去登录」），所以挂载即启动没有惊喜；
// 而且**必须先启动才拿得到网址**（网址是 CLI 打出来的，不是我们拼的）。
// 先启动、再把按钮摆出来，用户一按就有得点，不用等第二下。
//
// ── 结束的判据不是进程退出 ──────────────────────────────────────────
// 两个 CLI 都可能 0 退出却没登上（用户在网页上取消了、码过期了）。
// 所以进程结束后**再查一次 status**，以它为准（同 cliAuth/parse.ts 的
// looksSucceeded 那条注释：文本匹配是提示，CLI 自己报的状态才是判据）。
import { useEffect, useRef, useState } from 'react'

import { CheckIcon, CopyIcon, GlobeIcon } from '../../ui/Icons'
import type { CliAuthStatus, LoginState } from '../../../../shared/types'

type CliId = 'claude' | 'codex'

/** 面板自己的进度。**跟主进程推来的 LoginState 不是一回事** ——
 *  那边只知道「登录进程走到哪」，不知道「查完 status 了没」，
 *  而「登上了」这个结论只有查完才能下。 */
type Phase =
  | { k: 'starting' }
  /** 等用户去浏览器完成。prompt 里有网址 / 设备码 / 要不要粘码 */
  | { k: 'waiting'; url?: string; code?: string; needsCode?: boolean }
  /** 授权码已回写，等 CLI 反应（只有 claude 走这里） */
  | { k: 'submitting' }
  /** 登录进程结束了，正在查 status —— **这一步才决定成没成** */
  | { k: 'verifying' }
  | { k: 'done'; status: CliAuthStatus }
  | { k: 'failed'; error: string }

export function CliLoginPanel(props: {
  cli: CliId
  displayName: string
  /** 登录确认成功（已经查过 status）。调用方据此关掉面板、继续原来的动作 */
  onDone: (status: CliAuthStatus) => void
  onCancel: () => void
  /** 嵌在 CliSetupPanel（装→登录那条链路）里时为真：**不画自己的外框和标题栏** ——
   *  外面那层已经有了，再画一层会变成框里套框，标题还重复一遍 */
  bare?: boolean
}): React.JSX.Element {
  const { cli, displayName, onDone, onCancel, bare } = props
  const [phase, setPhase] = useState<Phase>({ k: 'starting' })
  const [code, setCode] = useState('')
  const [copied, setCopied] = useState(false)
  // 重试计数。**「重试」不能只把 phase 拨回 starting** —— 那样登录进程根本没重起，
  // 面板会永远停在「正在准备登录…」。让它进 effect 的依赖，改一次就真重跑一次
  const [attempt, setAttempt] = useState(0)
  // 卸载后不再 setState。登录流程横跨好几秒，中途面板完全可能被切走
  const aliveRef = useRef(true)
  // onDone 会随父组件重渲染换引用，用 ref 存着，免得下面那个 effect 反复重挂
  //（重挂 = 重新 startLogin = 又起一个登录进程，主进程那边会以「已经有一个在跑」拒绝，
  //  于是面板卡在 starting 再也出不来）
  const doneRef = useRef(onDone)
  doneRef.current = onDone

  useEffect(() => {
    aliveRef.current = true
    const off = window.api.cliAuth.onLogin((s: LoginState) => {
      if (!aliveRef.current || s.cli !== cli) return
      if (s.phase === 'waiting') {
        setPhase({ k: 'waiting', url: s.prompt?.url, code: s.prompt?.code, needsCode: s.prompt?.needsCode })
        return
      }
      if (s.phase === 'submitting') {
        setPhase({ k: 'submitting' })
        return
      }
      if (s.phase === 'failed') {
        setPhase({ k: 'failed', error: s.error || '登录没能完成' })
        return
      }
      if (s.phase === 'canceled') return // 是我们自己取消的，界面已经不在了
      if (s.phase === 'done') {
        // **进程结束 ≠ 登上了。** 去查一次真状态
        setPhase({ k: 'verifying' })
        void window.api.cliAuth.check(cli).then((st) => {
          if (!aliveRef.current) return
          if (st.status?.loggedIn) {
            setPhase({ k: 'done', status: st.status })
            doneRef.current(st.status)
          } else {
            setPhase({
              k: 'failed',
              // 分开说：读不到 ≠ 没登上。让人知道该重试还是该找我们
              error: st.status ? '登录流程结束了，但还是没登上' : '登录流程结束了，但读不到登录状态'
            })
          }
        })
      }
    })
    void window.api.cliAuth.startLogin(cli).then((r) => {
      if (!aliveRef.current || r.ok) return
      setPhase({ k: 'failed', error: r.error || '起不来登录流程' })
    })
    return () => {
      aliveRef.current = false
      off()
      // 面板关了就把登录进程带走 —— 留着它会占住「同时只能有一个登录流程」的位置，
      // 下次点登录会被拒
      void window.api.cliAuth.cancelLogin()
    }
  }, [cli, attempt])

  const openUrl = (url: string): void => void window.api.shell.openExternal(url)
  const copyUrl = (url: string): void => {
    void window.api.clipboard.writeText(url)
    setCopied(true)
    window.setTimeout(() => aliveRef.current && setCopied(false), 1600)
  }

  return (
    <div className={bare ? 'ac-login bare' : 'ac-login'}>
      {!bare && (
        <div className="ac-login-head">
          <span className="ac-login-title">登录 {displayName}</span>
          <button type="button" className="ac-login-x" onClick={onCancel} aria-label="取消登录">
            ×
          </button>
        </div>
      )}

      {phase.k === 'starting' && <div className="ac-login-step">正在准备登录…</div>}

      {phase.k === 'waiting' && (
        <>
          {phase.url ? (
            <>
              {/* **左键打开、右键复制** —— 右键那条是用户专门要的：
                  他要用自己信任的浏览器，而不是系统默认的那个。
                  提示写在按钮下面，因为右键功能不写出来没人会去试。 */}
              <button
                type="button"
                className="ac-login-go"
                onClick={() => openUrl(phase.url!)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  copyUrl(phase.url!)
                }}
              >
                {copied ? <CheckIcon size={13} /> : <GlobeIcon size={13} />}
                {copied ? '链接已复制' : '点我去登录'}
              </button>
              <div className="ac-login-hint">
                <CopyIcon size={10} />
                右键这个按钮可以<b>复制登录链接</b>，换一个浏览器打开也行
                {/* **但必须还在这台电脑上。** codex 的回调打到 localhost:1455，
                    claude 那条要把授权码粘回下面的输入框 —— 两条都跨不了设备。
                    不写清楚的话，有人会把链接发到手机上打开，然后卡住不知道为什么。 */}
                <b>（要在这台电脑上）</b>
              </div>
              {/* 网址原文也摆出来：有人就是想先看清楚要去哪儿再点 */}
              <div className="ac-login-url" title={phase.url}>
                {phase.url}
              </div>
            </>
          ) : (
            <div className="ac-login-step">正在向 {displayName} 要登录链接…</div>
          )}

          {/* codex 的设备码：用户要在网页上手输这一串，所以要大、要好认、要能复制 */}
          {phase.code && (
            <div className="ac-login-code">
              <span className="ac-login-code-l">在网页上输入这个一次性码</span>
              <button
                type="button"
                className="ac-login-code-v"
                onClick={() => void window.api.clipboard.writeText(phase.code!)}
                title="点一下复制"
              >
                {phase.code}
              </button>
            </div>
          )}

          {/* claude 的那条路：它在等我们把授权码写回 stdin。
              **这就是不让用户去终端的关键一步** —— 换成终端的话，
              用户得自己找到那个进程、把码粘进去 */}
          {phase.needsCode && (
            <div className="ac-login-paste">
              <span className="ac-login-code-l">把网页给你的授权码粘在这里</span>
              <div className="ac-login-paste-row">
                <input
                  className="ac-login-input"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && code.trim()) void window.api.cliAuth.submitCode(code)
                  }}
                  placeholder="粘贴授权码"
                  autoFocus
                  spellCheck={false}
                />
                <button
                  type="button"
                  className="ac-login-submit"
                  disabled={!code.trim()}
                  onClick={() => void window.api.cliAuth.submitCode(code)}
                >
                  提交
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {phase.k === 'submitting' && <div className="ac-login-step">正在验证授权码…</div>}
      {phase.k === 'verifying' && <div className="ac-login-step">正在确认登录状态…</div>}

      {phase.k === 'done' && (
        <div className="ac-login-ok">
          <CheckIcon size={13} />
          已登录{phase.status.account ? ` · ${phase.status.account}` : ''}
          {phase.status.method ? `（${phase.status.method}）` : ''}
        </div>
      )}

      {phase.k === 'failed' && (
        <div className="ac-login-err">
          {phase.error}
          <button
            type="button"
            className="ac-login-retry"
            onClick={() => {
              setPhase({ k: 'starting' })
              setAttempt((n) => n + 1)
            }}
          >
            重试
          </button>
        </div>
      )}
    </div>
  )
}
