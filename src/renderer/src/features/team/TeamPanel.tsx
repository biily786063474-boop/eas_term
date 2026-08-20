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
import { healthOf, fmtAge, labelOf, ageMsOf } from './agentAge'
import { ChipIcon, CloseIcon } from '../../ui/Icons'
import { useStore } from '../../store'
import './team.css'

/** 轮询间隔。**不做实时推送** —— 面板是「瞥一眼」的东西，2 秒足够，
 *  而为它新开一条事件通道会让主进程多一份订阅者管理。 */
const POLL_MS = 2000

export function TeamPanel({ cwd }: { cwd: string }): JSX.Element {
  const [rows, setRows] = useState<SessionBrief[] | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const requestConfirm = useStore((s) => s.requestConfirm)

  // 身份（角色名 / 是不是团队派生）**直接从 SessionBrief 读，不再从画布节点上算**。
  //
  // 这里原本遍历 tabs 的布局树、按 sessionId 建一张 identity 表，注释还写着「角色是
  // 画布这一侧的概念，主进程只管进程」。**那条判断被「关节点不杀进程」推翻了**：
  // 节点关掉之后 pane 就没了，而进程还在跑，于是这张表当场失明 ——
  // 角色名退回 CLI 名、`teamRows` 漏掉它导致「全部叫停」停不干净、team_status 完全
  // 看不见它。2026-08-19 真机复现过（关掉 css-dup-auditor 的节点，进程 69707 仍在
  // 写 .plans/，面板上只剩一个没名字的 claude，叫停计数从 2 掉到 1）。
  //
  // **别改回从 tabs 算。** 身份是会话的属性，存在主进程的 SessionRecord 上，
  // 和进程同生共死；视图可以随时消失，那是它的本分。

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
  if (rows.filter((r) => r.cwd === cwd).length === 0) {
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

  // **只列这个 Frame 自己的会话。**
  //
  // 原来是「本项目排前面、别处的排后面但照样列出来」。实际用起来是干扰：
  // 你在 A 项目的画布上看团队面板，列出来的却混着 B、C 项目里开着的 AI 对话 ——
  // 它们既不是这一批派出去的，你在这里也不该管它们（每个 Frame 有自己的面板）。
  const mine = rows.filter((r) => r.cwd === cwd)
  const sorted = [...mine].sort((a, b) => a.id.localeCompare(b.id))
  // 但**不能装作它们不存在** —— 别处还有 agent 在烧 token 这件事得让人知道，
  // 否则就成了「没有任何 UI 能管的后台进程」（方案里那条纪律）。
  // 只报个数、不列细节：去那个项目的面板上才管得了它。
  const elsewhere = rows.filter((r) => r.cwd !== cwd && r.alive).length

  // 团队派生的那些 —— 「全部叫停」只停它们，不碰你自己开的会话。
  // 判据来自 SessionBrief 而不是画布节点：**这一行正是那个 bug 的现场** ——
  // 原本读的是从 tabs 算出来的 identity，关掉某个 agent 的节点之后它就不再被算作
  // 团队成员，「全部叫停」把它漏在后台继续烧 token，而计数从 2 掉到 1，
  // 看起来完全正常。
  const teamRows = sorted.filter((r) => r.owner === 'team' && r.alive)

  return (
    <div className="tp">
      <div className="tp-head">
        <ChipIcon size={11} />
        <span>{sorted.length} 个会话</span>
        <span className="tp-spacer" />
        <span className="tp-dim">{sorted.filter((r) => r.alive).length} 个进程还在</span>
      </div>
      <div className="tp-list">
        {sorted.map((r) => {
          // busy 由主进程从 turn.start/turn.done 记着（SessionRecord.busy）。
          // **有它才分得清「干完了」和「卡住了」** —— headless 流式模式跑完一轮
          // 不退出，只看静默时长的话两者一模一样。
          const h = healthOf(r.alive, r.lastActiveAt, now, r.busy)
          const mine = r.cwd === cwd
          return (
            <div className={`tp-row h-${h}`} key={r.id}>
              <span className="tp-dot" />
              {/* 有角色就显示角色 —— 那才是「谁在干什么」。没有（你自己开的会话）
                  才退回显示 CLI 名，那时 CLI 是唯一能区分它们的东西。 */}
              <span className="tp-cli">{r.role ?? r.cli}</span>
              <span className="tp-cwd" title={r.cwd}>
                {r.role ? r.cli : mine ? '本项目' : (r.cwd.split('/').filter(Boolean).pop() ?? r.cwd)}
              </span>
              <span className="tp-spacer" />
              <span className="tp-state">{labelOf(h, r.owner === 'team')}</span>
              {/* 三种语义按状态切，判据在 agentAge.ts 的 ageMsOf（有单测盯着）。
                  停下来的行是定值 —— 它不该显示一个还在涨的数字。 */}
              <span
                className="tp-age"
                title={h === 'running' ? '已经跑了多久' : h === 'stalled' ? '多久没有动静了' : '这一轮跑了多久'}
              >
                {fmtAge(ageMsOf(h, r.startedAt, r.lastActiveAt, now))}
              </span>
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
        {elsewhere > 0 && (
          <span className="tp-elsewhere" title="在它们各自项目的团队面板里可以停">
            另有 {elsewhere} 个在其他项目
          </span>
        )}
      </div>
    </div>
  )
}
