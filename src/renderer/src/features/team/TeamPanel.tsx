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
import { useEffect, useMemo, useState } from 'react'
import type { SessionBrief } from '../../../../shared/agentChat'
import { collectLeaves } from '../../layout'
import { healthOf, fmtAge, type AgentHealth } from './agentAge'
import { ChipIcon, CloseIcon } from '../../ui/Icons'
import { useStore } from '../../store'
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
  const requestConfirm = useStore((s) => s.requestConfirm)

  /** sessionId → 这个会话在画布上的身份（角色名 / 是不是团队派生）。
   *
   *  主进程那份 SessionBrief **故意不带角色** —— 角色是画布这一侧的概念
   *  （谁开的、叫什么），主进程只管进程。在这里合并，两边各管各的。 */
  //
  //  订阅 tabs 本身、在 useMemo 里算 —— selector 里现造对象的话每次都是新引用，
  //  这个 store 又没有自定义比较器，面板会跟着无谓地重渲染。
  const tabs = useStore((s) => s.tabs)
  const identity = useMemo(() => {
    const m: Record<string, { role?: string; team: boolean }> = {}
    for (const t of tabs) {
      for (const l of collectLeaves(t.root)) {
        if (l.pane.kind !== 'agent' || !l.pane.sessionId) continue
        m[l.pane.sessionId] = { role: l.pane.role, team: l.pane.owner === 'team' }
      }
    }
    return m
  }, [tabs])

  /** 停掉一个会话。**这是终止不是暂停** —— agentChat:stop 在主进程是
   *  `sessions.delete(id)` + `proc.kill()`，会话记录整个删掉，resumeId 也没了，
   *  下次发消息会新开一个会话、接不上上下文。跟 15 分钟空闲回收（保留 rec、
   *  下次发送时接上）完全是两回事，所以要确认，文案也得把后果说清。 */
  const stop = (r: SessionBrief): void => {
    const go = (): void => {
      window.api.agentChat.stop(r.id)
      // 立刻从本地列表摘掉，不等下一次轮询 —— 2 秒的延迟会让人以为没点动
      setRows((list) => (list ? list.filter((x) => x.id !== r.id) : list))
    }
    if (!r.alive) return go() // 进程已经没了，这只是清理，不用问
    requestConfirm({
      message: `停掉这个 ${r.cli} 会话？进程会被终止，**上下文接不回来了** —— 下次在那个对话框里发消息是从头开始。`,
      confirmLabel: '停掉',
      onConfirm: go
    })
  }

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

  // 团队派生的那些 —— 「全部叫停」只停它们，不碰你自己开的会话
  const teamRows = sorted.filter((r) => identity[r.id]?.team && r.alive)

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
          const who = identity[r.id]
          return (
            <div className={`tp-row h-${h}`} key={r.id}>
              <span className="tp-dot" />
              {/* 有角色就显示角色 —— 那才是「谁在干什么」。没有（你自己开的会话）
                  才退回显示 CLI 名，那时 CLI 是唯一能区分它们的东西。 */}
              <span className="tp-cli">{who?.role ?? r.cli}</span>
              <span className="tp-cwd" title={r.cwd}>
                {who?.role ? r.cli : mine ? '本项目' : (r.cwd.split('/').filter(Boolean).pop() ?? r.cwd)}
              </span>
              <span className="tp-spacer" />
              <span className="tp-state">{LABEL[h]}</span>
              <span className="tp-age">{fmtAge(now - r.lastActiveAt)}</span>
              {/* 平时不显示，hover 这一行才出现 —— 一排常驻的 × 太容易误点，
                  而这颗按钮按下去是不可逆的 */}
              <button
                className="tp-stop"
                data-tip={r.alive ? '停掉这个会话（上下文接不回来）' : '清掉这条记录'}
                onClick={() => stop(r)}
              >
                <CloseIcon size={10} />
              </button>
            </div>
          )
        })}
      </div>
      <div className="tp-foot">
        {teamRows.length > 0 ? (
          <>
            <span>鼠标移到一行上可以停掉它</span>
            {/* **任何时候都必须一键能停** —— 方案里定的底线。
                这是这套系统能不能让人放心用的分界：派下去之后你要有一个
                随时能收手的地方，而不是只能一个个点。 */}
            <button
              className="tp-stopall"
              onClick={() =>
                requestConfirm({
                  message: `停掉这一批全部 ${teamRows.length} 个 agent？进程会被终止，它们已经写进 .plans/ 的东西还在。`,
                  confirmLabel: '全部停掉',
                  onConfirm: () => {
                    for (const r of teamRows) window.api.agentChat.stop(r.id)
                    setRows((list) => (list ? list.filter((x) => !teamRows.some((t) => t.id === x.id)) : list))
                  }
                })
              }
            >
              全部叫停（{teamRows.length}）
            </button>
          </>
        ) : (
          <span>鼠标移到一行上可以停掉它</span>
        )}
      </div>
    </div>
  )
}
