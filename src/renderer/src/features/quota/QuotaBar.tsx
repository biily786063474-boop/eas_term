// 画布右上角的额度条。**默认不显示**，点 top bar 那个 icon 才常驻。
//
// 数据从主进程来（quotaStore 采集 + 落盘），这里只显示。取数细节见 shared/quota.ts。
//
// ── 三条「让位」规则 ────────────────────────────────────────────────
// 右侧抽屉展开时、有新消息提醒时，这个条**暂时消失**（用户 2026-08-21 明确要求：
// 不要相互挤占空间）。它是随时可以看一眼的参考信息，不是非得占着那个角落 ——
// 而抽屉和提醒都是用户正在处理的事，那两个更要紧。

import { Fragment, useEffect, useReducer, useState } from 'react'
import { useStore } from '../../store'
import { liveCells, quotaSegments } from './segments'
import { useT } from '../../i18n.ts'
import type { T } from '../../../../shared/i18n/index.ts'
import { isWindowExpired, type QuotaSnapshot, type CliQuota, type QuotaWindow, isHot } from '../../../../shared/quota'
import './quotaBar.css'

// 下面三个是 shared/quota.ts 里 windowLabel / agoLabel / untilReset 的按语言版本
// （那边只有中文；中文输出与它们逐字一致）。
function windowLabel(tr: T, minutes?: number): string {
  if (!minutes) return tr('shell.quota.win.current')
  if (minutes <= 60) return tr('shell.quota.win.minutes', { n: minutes })
  if (minutes < 1440) return tr('shell.quota.win.hours', { n: Math.round(minutes / 60) })
  const days = Math.round(minutes / 1440)
  return days === 7 ? tr('shell.quota.win.week') : tr('shell.quota.win.days', { n: days })
}

function agoLabel(tr: T, updatedAt: number, now: number): string {
  const s = Math.max(0, Math.round((now - updatedAt) / 1000))
  if (s < 60) return tr('shell.quota.ago.now')
  const m = Math.round(s / 60)
  if (m < 60) return tr('shell.quota.ago.min', { n: m })
  const h = Math.round(m / 60)
  if (h < 24) return tr('shell.quota.ago.hour', { n: h })
  return tr('shell.quota.ago.day', { n: Math.round(h / 24) })
}

function untilReset(tr: T, resetsAt: number | undefined, now: number): string | null {
  if (typeof resetsAt !== 'number' || !Number.isFinite(resetsAt)) return null
  const ms = resetsAt * 1000 - now
  if (ms <= 0) return null
  const min = Math.floor(ms / 60000)
  if (min < 1) return tr('shell.quota.until.lt1')
  if (min < 60) return tr('shell.quota.until.min', { m: min })
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h < 24) return m ? tr('shell.quota.until.hm', { h, m }) : tr('shell.quota.until.h', { h })
  const d = Math.floor(h / 24)
  return tr('shell.quota.until.dh', { d, h: h % 24 })
}

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
  const tr = useT()
  const now = Date.now()
  const cells = liveCells(q, now)
  if (!cells.length) return null
  return (
    <span className={`qb-cli${q?.models?.length ? ' qb-models' : ''}`}>
      <span className="qb-name">{name}</span>
      {cells.map((w, i) => (
        <span
          key={i}
          // **判定不写在这里** —— 走 shared 的 isHot()：有服务端 severity 就信它，
          // 没有才回退到写死的 80%（三条通道里只有直连接口那条带判定）。
          className={`qb-pct${isHot(w) ? ' hot' : ''}`}
          // hover 才说明这个数字是哪个窗口的 —— 平时保持简约，
          // 一个百分比后面挂一串「5 小时」会把这条撑得很啰嗦。
          //
          // **用 data-tip 不用原生 title**：原生 title 在 Electron 里要悬停一秒多才弹、
          // 样式是系统那套，两个百分比并排时根本认不出哪个是哪个窗口——实际反馈就是
          // 「hover 没有提示」。ui/Tooltip.tsx 那套是 360ms、跟随主题、portal 到 body
          // 不会被玻璃面板裁切，全项目 63 处都走它，这里没有理由例外。
          //
          // 文案带上 CLI 名和「限额」二字：这两个数字挨着放，光说「5 小时」还是会
          // 让人分不清是谁的额度。
          // 新鲜度用**这一格自己**的 at，不是 CLI 级的 updatedAt：两条来源各自只报得出
          // 一部分窗口，用共用时间戳的话，一条七天事件会让旁边那个几小时前的五小时
          // 数字也显示成「刚刚采到」
          // 重置写**还有多久**，不写绝对时刻（2026-08-26 用户要求）：
          // 「8月28日 09:00 重置」要求人先想今天几号、再算差几天，而这一栏的用途
          // 恰恰是「我还能用多久」。相对量直接回答那个问题。
          // untilReset 已过重置时刻会返回 null —— 那种情况一个字都不显示，
          // 别写「0 小时后刷新」（时钟偏差和过期事件都会走到这里）。
          data-tip={tr('shell.quota.tip', {
            name,
            window: 'modelId' in w ? String(w.modelId) : windowLabel(tr, w.windowMinutes),
            used: w.percent,
            left: 100 - w.percent,
            reset: untilReset(tr, w.resetsAt, now) ? tr('shell.quota.resetIn', { time: untilReset(tr, w.resetsAt, now) ?? '' }) : '',
            ago: agoLabel(tr, w.at, now)
          })}
        >
          {'modelId' in w ? `${String(w.modelId)} ` : ''}{w.percent}%
        </span>
      ))}
    </span>
  )
}

/** 两种形态：
 *  · `float` —— 画布模式，右上角悬浮
 *  · `inline` —— 分屏模式，嵌在标签栏右端
 *
 *  分屏不能照搬悬浮：那儿是终端的内容区，一条 pill 压在上面会挡住第一行。
 *  标签栏右端本来就是空的，嵌进去既看得见又不占任何人的地方。 */
export function QuotaBar({ variant = 'float' }: { variant?: 'float' | 'inline' } = {}): JSX.Element | null {
  const tr = useT()
  const [on, setOn] = useState(readQuotaBarOn)
  const [q, setQ] = useState<QuotaSnapshot>({})
  // 「N 分钟前采到」不能停在渲染那一刻：数据迟迟不来的时候，恰恰是最需要
  // 让人看出「这个数已经旧了」的时候。每分钟自己走一格，代价可以忽略。
  const [, tickNow] = useReducer((x: number) => x + 1, 0)
  useEffect(() => {
    const t = setInterval(tickNow, 60_000)
    return () => clearInterval(t)
  }, [])
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
  // 各就各位：悬浮那份只在画布出现，内联那份只在分屏出现
  if (variant === 'float' && viewMode !== 'canvas') return null
  if (variant === 'inline' && viewMode !== 'split') return null
  // 让位：抽屉开着、有等你处理的提醒、或者有模块最大化。
  // **只对悬浮那份生效** —— 内联的嵌在标签栏里，本来就不压着任何人，
  // 让它跟着消失只会让人以为数据没了。
  if (variant === 'float' && (wikiOpen || resOpen || hasAttention || maximized)) return null

  // **按数据判，不能按元素判。** `<CliPart/>` 即使内部 return null，
  // 元素本身永远是 truthy —— 拿它做条件的话，只有一边有数据时
  // 末尾会多挂一个孤零零的分隔符（实测「Codex 2% |」）。
  // 哪几段、什么顺序，全在 `segments.ts`（纯函数、有单测）。
  // **分隔符按段数拼，不要两两判断** —— 原来那种写法两段时对、三段时会漏一根竖线。
  const parts = quotaSegments(q, Date.now())
  if (parts.length === 0) return null // 都还没数据 —— 整条不出现

  return (
    <div className={`qb qb-${variant}`} role="status" aria-label={tr('shell.quota.ariaLabel')}>
      {parts.map((p, i) => (
        <Fragment key={p.name}>
          {i > 0 && <span className="qb-sep">|</span>}
          {p.unavailable ? <span className="qb-cli"><span className="qb-name">{p.name}</span><span className="qb-pct" data-tip={tr('shell.quota.unavailableTip')}>{tr('shell.quota.unavailable')}</span></span> : <CliPart name={p.name} q={p.q} />}
        </Fragment>
      ))}
    </div>
  )
}


/** top bar 上那颗开关。**默认关着** —— 额度条是常驻在视野边缘的东西，
 *  该由用户自己决定要不要看见，不该开箱就占地方。 */
export function QuotaBarToggle(): JSX.Element {
  const tr = useT()
  const [on, setOn] = useState(readQuotaBarOn)
  useEffect(() => {
    const h = (): void => setOn(readQuotaBarOn())
    window.addEventListener('eas:quotaBar', h)
    return () => window.removeEventListener('eas:quotaBar', h)
  }, [])
  return (
    <button
      className={`tb-item${on ? ' on' : ''}`}
      data-tip={on ? tr('shell.quota.tipHide') : tr('shell.quota.tipShow')}
      aria-pressed={on}
      onClick={() => setQuotaBarOn(!on)}
    >
      {tr('shell.quota.button')}
    </button>
  )
}
