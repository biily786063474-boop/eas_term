// 首启引导：一个 CLI 都没装时，告诉用户 agent 能力需要什么、怎么装。
//
// 在这之前的行为是「什么都不说」——skillStatus 的 needsAttention 判据是
// `装了 CLI && 没装技能包`，两个都没装时它永远是 false。新用户下载完打开，
// 看到的是一堆点了没反应的 agent 控件，不知道为什么。
//
// 安装这件事**不代跑**：点「安装」只是在画布上开一个终端、把命令填进去，
// 回车由用户自己按。理由见 src/main/agentInstall.ts 顶部。
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

/** 展示顺序。**不用 Object.keys(plan)** —— 那样顺序跟着对象字面量走，
 *  将来重排 installPlan 的字段会静默改变界面顺序。这里显式定死。 */
const AGENT_KINDS: AgentKind[] = ['claude', 'codex']
import { useStore } from '../../store'
import type { InstallPlan, AgentInstallInfo, AgentKind } from '../../../../shared/types'
import { SparkleIcon, TerminalIcon } from '../../ui/Icons'

const DISMISS_KEY = 'eas.onboarding.dismissed'

export function AgentOnboarding(): JSX.Element | null {
  const agentCli = useStore((s) => s.agentCli)
  const refreshAgentCli = useStore((s) => s.refreshAgentCli)
  const prefillTerminal = useStore((s) => s.prefillTerminal)
  const [plan, setPlan] = useState<InstallPlan | null>(null)
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISS_KEY) === '1')
  const [picked, setPicked] = useState<AgentKind | null>(null)

  const noCli = !!agentCli && !agentCli.claude && !agentCli.codex

  useEffect(() => {
    void refreshAgentCli()
  }, [refreshAgentCli])

  useEffect(() => {
    if (!noCli || dismissed || plan) return
    void window.api.skill.installPlan().then(setPlan)
  }, [noCli, dismissed, plan])

  // 用户装完之后回到 app：重新探测一次，装上了就自动收起引导。
  // 不轮询——只在窗口重新获得焦点时查，安装期间他会离开窗口去看终端/浏览器登录。
  //
  // **不再限定「两个 CLI 都没有」时才听。** 原来那个条件漏掉了最常见的坏法：
  // 只有其中一个坏了（2026-08-11 实测：claude 的 npm 自更新被 allow-scripts 拦掉、
  // 原生二进制没就位，而 codex 好好的）。那种情况 noCli 是 false，这个监听根本不挂，
  // agentCli.claude 就永久停在 false —— 修好了也读不到，只能重启整个软件。
  // refreshAgentCli 自带 5s 节流，来回切窗口不会打成连发。
  useEffect(() => {
    const onFocus = (): void => void refreshAgentCli()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refreshAgentCli])

  if (!noCli || dismissed || !plan) return null

  const close = (forever: boolean): void => {
    if (forever) localStorage.setItem(DISMISS_KEY, '1')
    setDismissed(true)
  }

  const install = (info: AgentInstallInfo, cmd: string): void => {
    setPicked(null)
    close(false)
    void prefillTerminal(cmd)
  }

  const card = (key: AgentKind, info: AgentInstallInfo): JSX.Element => {
    const best = info.options[0]
    const open = picked === key
    return (
      <div className={`onb-card${open ? ' open' : ''}`} key={key}>
        <div className="onb-card-name">{info.name}</div>
        <div className="onb-card-vendor">{info.vendor}</div>
        {/* 能力范围来自数据（AgentInstallInfo.scope），不在这里按 CLI 名字判断。
            没有 note 的就是全都支持，不用占版面解释。 */}
        {!!info.scope.note && <div className="onb-card-scope">{info.scope.note}</div>}
        {!open ? (
          <button className="onb-btn" disabled={!best} onClick={() => setPicked(key)}>
            {best ? '安装' : '暂无可用方式'}
          </button>
        ) : (
          <div className="onb-opts">
            {info.options.map((o) => (
              <button key={o.cmd} className="onb-opt" onClick={() => install(info, o.cmd)}>
                <span className="onb-opt-via">{o.via}</span>
                <code className="onb-opt-cmd">{o.cmd}</code>
              </button>
            ))}
            <button className="onb-opt-back" onClick={() => setPicked(null)}>
              返回
            </button>
          </div>
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
        <div className="onb-title">让终端里跑起 AI</div>
        <p className="onb-body">
          Eas-Term 的 agent 能力（画布里的 Agent 控制台、会话回溯、AI 直接操作画板）
          需要 <b>Claude Code</b> 或 <b>Codex</b> 才能工作 —— 这两个都是各自厂商的命令行工具，
          需要你自己的账号。<b>没装它们，终端、画布、文件预览、词典照常可用。</b>
        </p>

        <div className="onb-cards">
          {/* 遍历 AgentKind，不写死几行 —— 有过一次数据加了、这里忘了改的教训，
              结果那个 CLI 在安装引导里整个是隐形的。加下一个 CLI 时这里不用再动。 */}
          {AGENT_KINDS.map((k) => card(k, plan[k]))}
        </div>

        <div className="onb-how">
          <TerminalIcon size={12} />
          <span>
            点安装不会替你执行任何东西 —— 我们只是<b>把命令填进一个终端</b>，
            跑什么你看得见，回车你自己按。装完回到这里会自动识别。
          </span>
        </div>

        <div className="onb-actions">
          <button className="onb-ghost" onClick={() => close(true)}>
            我只用终端和画布，别再提示
          </button>
          <span className="onb-spacer" />
          <button className="onb-ghost" onClick={() => close(false)}>
            以后再说
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
