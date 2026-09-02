// 首启引导：告诉新用户这软件要装什么，并且**当场就能装完、登完**。
//
// ── 2026-08-30 这一版改了什么，为什么 ──────────────────────────────
// 用户原话：「我希望用户第一次登陆软件的时候先有引导页面去引导用户安装所需 cli，
// 用户可以选择跳过……用户在 AI 对话模式下的安装行为也不要去显示终端，
// 要用安装进度条以及 cli 首次安装成功的某些选项以 GUI 的形式引导用户完成初次的设置链路」。
//
// 三处改动，每一处都对着一个真实的坏结果：
//
// ① **弹出条件从「一个 CLI 都没装」改成「首次启动且没全都就绪」。**
//    老判据只看装没装 —— 而「装了但没登录」的人一样用不了，却什么提示都收不到。
//    那正是分发侧最疼的一种：他以为装完就完事了，一发消息撞 401，
//    界面只说「CLI 进程退出（code 1）」。
//
// ② **装和登录都在这一页里做完，不再把命令甩进终端。**
//    原来点安装是 `prefillTerminal(cmd)` —— 用户看着一个陌生终端，
//    不知道该不该按回车，装完还得自己敲 `claude login`。
//    现在走 CliSetupPanel：进度条 → 装完自动接登录 → 全程 GUI。
//    **失败时仍然把输出摆出来、并留「填进终端我自己来」那条退路** ——
//    公司网络 / 代理 / 权限的问题只有在终端里才解得开（agentInstall.ts 第三条理由）。
//
// ③ **状态显示「登没登录」，不只是「装没装」。**
//    数据从 cliAuth.check 来，它把两件事分开报，还单独报「读不到」——
//    读不到不能说成没登录，那会把人推去做一次无用的重新登录。
//
// **没有另起一个引导页。** 这个文件本来就是干这件事的；再做一个新的，
// 两个引导会同时弹，措辞还不一样。
//
// 安装仍然**只在用户点过之后才跑**，且**命令原文一直摆在他眼前**（CliSetupPanel
// 的第一步就是让他看清要执行什么）—— 这是它跟「静默装全局 CLI」的分界线。
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

/** 展示顺序。**不用 Object.keys(plan)** —— 那样顺序跟着对象字面量走，
 *  将来重排 installPlan 的字段会静默改变界面顺序。这里显式定死。 */
const AGENT_KINDS: AgentKind[] = ['claude', 'codex']
import { useStore } from '../../store'
import { CliSetupPanel, CliStateLabel } from '../agentChat/CliSetupPanel'
import type { InstallPlan, AgentInstallInfo, AgentKind, CliAuthState } from '../../../../shared/types'
import { SparkleIcon } from '../../ui/Icons'

const DISMISS_KEY = 'eas.onboarding.dismissed'

export function AgentOnboarding(): JSX.Element | null {
  const refreshAgentCli = useStore((s) => s.refreshAgentCli)
  const [plan, setPlan] = useState<InstallPlan | null>(null)
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISS_KEY) === '1')
  /** 展开了哪个 CLI 的安装方式列表（官方脚本 / brew / npm） */
  const [picked, setPicked] = useState<AgentKind | null>(null)
  /** 正在给哪个 CLI 走「装 → 登录」。cmd 为空 = 只登录 */
  const [setup, setSetup] = useState<{ kind: AgentKind; cmd?: string } | null>(null)
  /** 每个 CLI 的真实状态（装没装 / 登没登 / 读不到）。null = 还没查回来 */
  const [auth, setAuth] = useState<Partial<Record<AgentKind, CliAuthState>>>({})
  /** 随包的 omp 配好了没有。**undefined = 还没查回来**，与「查回来是 false」必须分开 ——
   *  合成一个布尔的话，omp 状态还在路上时 anyReady 先算出 false，引导页会闪一下再消失。
   *  它不走 cliAuth（那套只认 claude / codex，见 preload 的注释），所以另存一份。 */
  const [ompReady, setOmpReady] = useState<boolean | undefined>(undefined)

  const check = (k: AgentKind): void => {
    void window.api.cliAuth.check(k).then((st) => setAuth((cur) => ({ ...cur, [k]: st })))
  }
  /** 查一次 omp。读不到（IPC 抛了）按「没配好」算 —— 这里的代价只是多弹一次引导页，
   *  而反过来（读不到当已就绪）会让真正一个大脑都没有的人什么提示都收不到。 */
  const checkOmp = (): void => {
    void window.api.omp
      .status()
      .then((raw) => {
        const st = raw as { installed?: boolean; status?: { loggedIn?: boolean } } | null
        setOmpReady(!!st?.installed && st?.status?.loggedIn === true)
      })
      .catch(() => setOmpReady(false))
  }

  useEffect(() => {
    void refreshAgentCli()
    // **并发查，不排队** —— 串行的话两个 CLI 冷启要等两遍
    for (const k of AGENT_KINDS) check(k)
    checkOmp()
  }, [refreshAgentCli])

  useEffect(() => {
    if (dismissed || plan) return
    void window.api.skill.installPlan().then(setPlan)
  }, [dismissed, plan])

  // 用户装完之后回到 app：重新探测一次，装上了就自动更新状态。
  // 不轮询——只在窗口重新获得焦点时查，安装期间他会离开窗口去看终端/浏览器登录。
  //
  // **不再限定「两个 CLI 都没有」时才听。** 原来那个条件漏掉了最常见的坏法：
  // 只有其中一个坏了（2026-08-11 实测：claude 的 npm 自更新被 allow-scripts 拦掉、
  // 原生二进制没就位，而 codex 好好的）。那种情况 noCli 是 false，这个监听根本不挂，
  // agentCli.claude 就永久停在 false —— 修好了也读不到，只能重启整个软件。
  // refreshAgentCli 自带 5s 节流，来回切窗口不会打成连发。
  useEffect(() => {
    const onFocus = (): void => {
      void refreshAgentCli()
      for (const k of AGENT_KINDS) check(k)
      checkOmp()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refreshAgentCli])

  // **每一个都查回来了才判断要不要弹。** 少一个就下结论的话，
  // 会在启动瞬间闪一下引导页然后消失（查得慢的那个刚好是装好的）。
  //
  // **omp 这一项两处都要并进去。** 只并 anyReady 的话，allChecked 会在两个 CLI 查完
  // 的那一刻就为真，而此时 omp 还没回来 → anyReady 暂时是 false → 引导页先弹出来，
  // 等 omp 回来才消失，用户看到的是一次闪烁。
  const allChecked = AGENT_KINDS.every((k) => auth[k]) && ompReady !== undefined
  const anyReady = AGENT_KINDS.some((k) => auth[k]?.status?.loggedIn === true) || ompReady === true
  // 已经有一个能用了就不打扰 —— 这一页的目的是「让他能开始用」，
  // 不是「把两个都装齐」。装第二个是随时可以做的事，不该拦在启动路上。
  if (dismissed || !plan || !allChecked || anyReady) return null

  const close = (): void => {
    // **跳过一律持久化。** 每次启动都弹同一页是骚扰；
    // 而跳过不是死路 —— 第一次在终端或 AI 对话里选到没装的 CLI 时，
    // 那边的闸门会再问一次（用的是同一套 CliSetupPanel，措辞一致）。
    localStorage.setItem(DISMISS_KEY, '1')
    setDismissed(true)
  }

  const card = (key: AgentKind, info: AgentInstallInfo): JSX.Element => {
    const st = auth[key]
    const installed = !!st?.installed
    // **null 是「读不到」，不是「没登录」** —— 两者界面上说的话不一样
    const loggedIn = st?.status ? st.status.loggedIn : null
    const ready = installed && loggedIn === true
    const best = info.options[0]
    const open = picked === key
    return (
      <div className={`onb-card${open ? ' open' : ''}`} key={key}>
        <div className="onb-card-name">{info.name}</div>
        <div className="onb-card-vendor">{info.vendor}</div>
        {/* 能力范围来自数据（AgentInstallInfo.scope），不在这里按 CLI 名字判断。
            没有 note 的就是全都支持，不用占版面解释。 */}
        {!!info.scope.note && <div className="onb-card-scope">{info.scope.note}</div>}
        <div className="onb-card-state">
          <CliStateLabel installed={installed} loggedIn={loggedIn} />
          {st?.status?.account ? <span className="ac-ob-acc">{st.status.account}</span> : null}
        </div>
        {ready ? null : open ? (
          <div className="onb-opts">
            {info.options.map((o) => (
              <button key={o.cmd} className="onb-opt" onClick={() => { setPicked(null); setSetup({ kind: key, cmd: o.cmd }) }}>
                <span className="onb-opt-via">{o.via}</span>
                <code className="onb-opt-cmd">{o.cmd}</code>
              </button>
            ))}
            <button className="onb-opt-back" onClick={() => setPicked(null)}>
              返回
            </button>
          </div>
        ) : installed ? (
          // 装了但没登录：直接进登录，不用再选安装方式
          <button className="onb-btn" onClick={() => setSetup({ kind: key })}>
            登录
          </button>
        ) : (
          <button className="onb-btn" disabled={!best} onClick={() => setPicked(key)}>
            {best ? '安装' : '暂无可用方式'}
          </button>
        )}
      </div>
    )
  }

  return createPortal(
    <div className="onb-mask">
      <div className="onb-modal">
        <div className="onb-icon">
          <SparkleIcon size={18} />
        </div>
        <div className="onb-title">开始之前，先让它有个大脑</div>
        <p className="onb-body">
          Eas-Term 自己不会说话 —— 干活的是 <b>Claude Code</b> 或 <b>Codex</b>，
          它们是各自厂商的命令行工具，要用你自己的账号登录。
          <b>装好任意一个就能开始</b>，两个都装也行；
          <b>也可以直接用自带的 omp</b> —— 它随软件一起装好了，选个模型服务商、填一把 key 就能聊。
          没装它们，终端、画布、文件预览、辞典照常可用。
        </p>

        <div className="onb-cards">
          {/* 遍历 AgentKind，不写死几行 —— 有过一次数据加了、这里忘了改的教训，
              结果那个 CLI 在安装引导里整个是隐形的。加下一个 CLI 时这里不用再动。 */}
          {AGENT_KINDS.map((k) => card(k, plan[k]))}
        </div>

        {/* 「装 → 登录」这条链路跟 AI 对话里用的是**同一个组件**。
            另做一份的话两边措辞会分叉，而分叉的那份没人会去修。 */}
        {setup && (
          <CliSetupPanel
            cliId={setup.kind}
            displayName={plan[setup.kind].name}
            installCmd={setup.cmd}
            from={setup.cmd ? 'install' : 'login'}
            onCancel={() => {
              setSetup(null)
              check(setup.kind)
            }}
            onDone={() => {
              setSetup(null)
              check(setup.kind)
            }}
          />
        )}

        <div className="onb-actions">
          <button className="onb-ghost" onClick={close}>
            先跳过，我自己来
          </button>
          <span className="onb-spacer" />
          <span className="onb-note">跳过之后，第一次选 CLI 时还会再提醒你一次</span>
        </div>
      </div>
    </div>,
    document.body
  )
}
