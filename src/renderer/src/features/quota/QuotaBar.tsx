// 画布右上角的额度条。**默认不显示**，点 top bar 那个 icon 才常驻。
//
// 数据从主进程来（quotaStore 采集 + 落盘），这里只显示。取数细节见 shared/quota.ts。
//
// ── 三条「让位」规则 ────────────────────────────────────────────────
// 右侧抽屉展开时、有新消息提醒时，这个条**暂时消失**（用户 2026-08-21 明确要求：
// 不要相互挤占空间）。它是随时可以看一眼的参考信息，不是非得占着那个角落 ——
// 而抽屉和提醒都是用户正在处理的事，那两个更要紧。

import { useEffect, useState } from 'react'
import { useStore } from '../../store'
import { GaugeIcon } from '../../ui/Icons'
import { windowLabel, type QuotaSnapshot, type CliQuota } from '../../../../shared/quota'
import './quotaBar.css'

/** 开关记在 localStorage：它是「这台机器上我想不想看见它」这种个人偏好，
 *  不值得为它开一条 IPC，也不该跟着项目走。 */
const KEY = 'eas.quotaBar.on'

export function readQuotaBarOn(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export function setQuotaBarOn(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? '1' : '0')
  } catch {
    /* 隐私模式之类读不了 —— 那就这次会话内有效，不值得报错 */
  }
  window.dispatchEvent(new CustomEvent('eas:quotaBar'))
}

/** 一个 CLI 的那一截。**两个窗口都没有数据就整段不渲染** —— 用户拍板：
 *  没数就不显示那一侧，不显示 0%、也不占位。一个永远是「—」的格子
 *  每天看着，不如没有。 */
function CliPart({ name, q }: { name: string; q?: CliQuota }): JSX.Element | null {
  if (!q || (!q.primary && !q.secondary)) return null
  const cells = [q.primary, q.secondary].filter(Boolean)
  return (
    <span className="qb-cli">
      <span className="qb-name">{name}</span>
      {cells.map((w, i) => (
        <span
          key={i}
          className={`qb-pct${w!.percent >= 80 ? ' hot' : ''}`}
          // hover 才说明这个数字是哪个窗口的 —— 平时保持简约，
          // 一个百分比后面挂一串「5 小时」会把这条撑得很啰嗦
          title={`${windowLabel(w!.windowMinutes)}已用 ${w!.percent}%${
            w!.resetsAt ? ` · ${new Date(w!.resetsAt * 1000).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 重置` : ''
          }`}
        >
          {w!.percent}%
        </span>
      ))}
    </span>
  )
}

export function QuotaBar(): JSX.Element | null {
  const [on, setOn] = useState(readQuotaBarOn)
  const [q, setQ] = useState<QuotaSnapshot>({})
  const viewMode = useStore((s) => s.viewMode)
  const wikiOpen = useStore((s) => s.wikiDrawerOpen)
  const resOpen = useStore((s) => s.resDrawerOpen)
  const hasAttention = useStore((s) => s.attentionPtys.length > 0)
  // 有模块最大化时也让位：最大化的节点铺满整个视口，这条正好悬在它的
  // 标题栏上，把关闭/还原那些按钮挡住（用户 2026-08-21 截图）。
  // 跟抽屉、提醒同一条道理 —— 用户正在专注的东西优先，额度是随时能看的参考。
  const maximized = useStore((s) => !!s.maximizedNode)

  // 开关变化：同一个窗口里 icon 点了要立刻反应，所以走自定义事件而不是轮询
  useEffect(() => {
    const h = (): void => setOn(readQuotaBarOn())
    window.addEventListener('eas:quotaBar', h)
    return () => window.removeEventListener('eas:quotaBar', h)
  }, [])

  useEffect(() => {
    void window.api.quota.get().then((d) => setQ((d ?? {}) as QuotaSnapshot))
    return window.api.quota.onData((d) => setQ((d ?? {}) as QuotaSnapshot))
  }, [])

  if (!on) return null
  // 只在画布模式出现：它是画布右上角的悬浮件，分屏/看板另有自己的布局
  if (viewMode !== 'canvas') return null
  // 让位：抽屉开着、或者有等你处理的提醒
  if (wikiOpen || resOpen || hasAttention || maximized) return null

  // **按数据判，不能按元素判。** `<CliPart/>` 即使内部 return null，
  // 元素本身永远是 truthy —— 拿它做条件的话，只有一边有数据时
  // 末尾会多挂一个孤零零的分隔符（实测「Codex 2% |」）。
  const has = (c?: CliQuota): boolean => !!c && (!!c.primary || !!c.secondary)
  const hasCodex = has(q.codex)
  const hasClaude = has(q.claude)
  if (!hasCodex && !hasClaude) return null // 两边都还没数据 —— 整条不出现

  return (
    <div className="qb" role="status" aria-label="额度用量">
      {hasCodex && <CliPart name="Codex" q={q.codex} />}
      {hasCodex && hasClaude && <span className="qb-sep">|</span>}
      {hasClaude && <CliPart name="Claude Code" q={q.claude} />}
    </div>
  )
}


/** top bar 上那颗开关。**默认关着** —— 额度条是常驻在视野边缘的东西，
 *  该由用户自己决定要不要看见，不该开箱就占地方。 */
export function QuotaBarToggle(): JSX.Element {
  const [on, setOn] = useState(readQuotaBarOn)
  useEffect(() => {
    const h = (): void => setOn(readQuotaBarOn())
    window.addEventListener('eas:quotaBar', h)
    return () => window.removeEventListener('eas:quotaBar', h)
  }, [])
  return (
    <button
      className={`dictback-btn${on ? ' on' : ''}`}
      data-tip={on ? '收起额度条' : '在画布右上角常驻显示额度'}
      aria-pressed={on}
      onClick={() => setQuotaBarOn(!on)}
    >
      <GaugeIcon size={13} />
    </button>
  )
}
