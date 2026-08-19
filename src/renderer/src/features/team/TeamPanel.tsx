// 团队面板（画布组件）。**第一期是只读的** —— 它把这个页面名下所有 AI 会话
// 列成一张表：谁、在哪、活着吗、多久没动了。
//
// 为什么先做只读：多 agent 的第一步不是「能派活」，是「看得见」。
// 你现在同时开三个 AI 对话就已经需要这个视图了，而它不依赖任何新的编排能力。
//
// 它也是后续两件事的前提：
//   · 「关节点不杀进程」必须等这里能停会话之后才能做，否则关掉的 agent
//     变成没有任何 UI 能管的后台进程（15 分钟空闲回收对活跃会话无效，
//     见 main/agentChat/session.ts 里那段注释）
//   · 派活（team_spawn）要在这里显示批次与用量
import { useEffect, useState } from 'react'
import type { SessionBrief } from '../../../../shared/agentChat'
import { healthOf, fmtAge, type AgentHealth } from './agentAge'
import { ChipIcon } from '../../ui/Icons'
import './team.css'

/** 轮询间隔。**不做实时推送** —— 面板是「瞥一眼」的东西，2 秒足够，
 *  而为它新开一条事件通道会让主进程多一份订阅者管理。 */
const POLL_MS = 2000

const LABEL: Record<AgentHealth, string> = {
  running: '在跑',
  stalled: '可能卡住',
  idle: '空闲',
  dead: '已停'
}

export function TeamPanel({ cwd }: { cwd: string }): JSX.Element {
  const [rows, setRows] = useState<SessionBrief[] | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    let alive = true
    const tick = async (): Promise<void> => {
      const list = await window.api.agentChat.listSessions().catch(() => [])
      if (!alive) return
      setRows(list)
      setNow(Date.now())
    }
    void tick()
    const t = window.setInterval(() => void tick(), POLL_MS)
    return () => {
      alive = false
      window.clearInterval(t)
    }
  }, [])

  if (rows === null) return <div className="tp-empty">读取中…</div>
  if (rows.length === 0) {
    return (
      <div className="tp-empty">
        还没有会话在跑
        <span className="tp-empty-hint">
          {/* 这一句是真机验证时补的：开了 2 个 AI 对话节点、面板仍然空，
              一开始以为是 bug。实际上 agentChat:start 要到**发第一条消息**才调，
              空态的对话框还没有进程。面板列的是进程不是节点 —— 它要回答的是
              「谁在烧钱」，不是「我开了几个框」。 */}
          开一个 AI 对话还不算 —— 发出第一条消息、CLI 真的起来了，才会出现在这里
        </span>
      </div>
    )
  }

  // 本项目的排在前面 —— 面板挂在某个项目下，那个项目的 agent 最相关
  const sorted = [...rows].sort((a, b) => {
    const ma = a.cwd === cwd ? 0 : 1
    const mb = b.cwd === cwd ? 0 : 1
    return ma - mb || a.id.localeCompare(b.id)
  })

  return (
    <div className="tp">
      <div className="tp-head">
        <ChipIcon size={11} />
        <span>{rows.length} 个会话</span>
        <span className="tp-spacer" />
        <span className="tp-dim">{rows.filter((r) => r.alive).length} 个进程还在</span>
      </div>
      <div className="tp-list">
        {sorted.map((r) => {
          // busy 这一期拿不到（它在各个 AgentChatView 的组件状态里，没有汇总通道）——
          // 传 undefined 让 healthOf 退回「多久没动」那条判据。第二期派活时
          // 会话状态会进 team.json，那时才有准确的 busy。
          const h = healthOf(r.alive, r.lastActiveAt, now)
          const mine = r.cwd === cwd
          return (
            <div className={`tp-row h-${h}`} key={r.id}>
              <span className="tp-dot" />
              <span className="tp-cli">{r.cli}</span>
              <span className="tp-cwd" title={r.cwd}>
                {mine ? '本项目' : (r.cwd.split('/').filter(Boolean).pop() ?? r.cwd)}
              </span>
              <span className="tp-spacer" />
              <span className="tp-state">{LABEL[h]}</span>
              <span className="tp-age">{fmtAge(now - r.lastActiveAt)}</span>
            </div>
          )
        })}
      </div>
      <div className="tp-foot">
        只读视图 · 派活与叫停在下一期
      </div>
    </div>
  )
}
