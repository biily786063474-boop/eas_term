// 主窗口侧的灵动岛数据源：把散在 store 各处的状态聚合成一帧快照推给主进程，
// 并接住灵动岛回传的动作。
//
// 为什么聚合放在渲染层而不是主进程：ptyId 落在哪个 tab、哪个 Frame 的哪个节点、
// 那个终端叫什么名字——这些只有渲染层的 store 知道。主进程要算就得把整棵布局树同步过去，
// 那等于把状态复制一份，两边迟早不一致。主进程只做转发。
import { useEffect, useRef, useState } from 'react'
import { useStore } from '../../store'
import type { IslandAction, IslandNotice, IslandRunning, IslandState } from '../../../../shared/types'
import { attentionKindOf, locate, statusOf, urgencyCmp } from './machine'
import type { Located, LocateCtx } from './machine'
import { focusTerminal } from './useStatus'

/** 推送节流：终端标题一秒能变好几次，不节流就是一秒几十帧 IPC */
const PUSH_MS = 250
/** 写回后等 spinner 复活的宽限期。超时还没转起来就判定这次点击没生效。
 *  1.5s 是实测值：CLI 收到选择后重新开跑通常在几百毫秒内，
 *  给到 1.5s 既不会误判慢的情况，也不会让用户对着一个死按钮发呆太久。 */
const STALE_MS = 1500

/** 灵动岛还要几个 machine.Located 不管的字段（模型、耗时档、会话 id、跑的哪个 CLI）——
 *  那些只有灵动岛的卡片用，放进状态机会让它认识一堆与「状态」无关的东西。 */
interface IslandExtra {
  cwd?: string
  model?: string
  effort?: string
  /** 该终端绑定的 CLI 会话 id —— 取 transcript 必须用它，否则同项目多终端会串 */
  sessionId?: string
  /** 跑的是哪个 CLI（没配 Agent 控制台的裸终端按 claude 算，只影响文案） */
  agent: 'claude' | 'codex'
}

/** 从当前 store 解出某个 pty 的落点 + 灵动岛专用字段；找不到（终端已关）返回 null */
function locateForIsland(ptyId: string, ctx: LocateCtx): (Located & IslandExtra) | null {
  const base = locate(ptyId, ctx)
  if (!base) return null
  const st = useStore.getState()
  const frame = st.canvas.frames.find((f) => f.id === base.frameId)
  const node = frame?.nodes.find((n) => n.id === base.nodeId)
  const agent = node?.agent
  const kind = agent?.kind ?? 'claude'
  const project = st.projects.find((p) => p.id === base.projectId)
  return {
    ...base,
    cwd: project?.path,
    model: agent?.model?.[kind],
    effort: agent?.effort?.[kind],
    sessionId: agent?.session?.[kind],
    agent: kind
  }
}

/** 一条通知的会话正文（异步从 transcript 取来，缓存住） */
interface NoticeDetail {
  ask: string
  answer: string
  at: number
}

export function useIslandFeed(): void {
  const runningPtys = useStore((s) => s.runningPtys)
  const attentionPtys = useStore((s) => s.attentionPtys)
  // 点过「知道了」的通知 id。进依赖是必须的：不订阅的话点完要等下一次
  // 状态变化才把这条从岛上摘掉，而「点了知道了」本身往往就是最后一次变化
  const silencedNotices = useStore((s) => s.silencedNotices)
  const tabs = useStore((s) => s.tabs)
  const projects = useStore((s) => s.projects)
  const frames = useStore((s) => s.canvas.frames)
  const ptyTiming = useStore((s) => s.ptyTiming)
  const ptyApproval = useStore((s) => s.ptyApproval)
  const approvalSentAt = useStore((s) => s.approvalSentAt)

  // transcript 是异步读的，读到了缓存下来。key: ptyId
  const [details, setDetails] = useState<Record<string, NoticeDetail>>({})
  // 已经发起过读取的 ptyId，避免同一条通知反复读盘
  const fetched = useRef(new Set<string>())
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** 上次真正推出去的时刻，节流用 */
  const lastPush = useRef(0)
  /** 始终指向**最新一次渲染**里的 push。
   *  尾推的 setTimeout 捕获的是排队那一刻的闭包，而排队期间状态还在变；
   *  经这个 ref 取才能保证发出去的是最新快照，而不是 250ms 前的。 */
  const pushRef = useRef<() => void>(() => {})

  // 新出现的「需处理」终端 → 去把它这一轮的问答捞出来
  useEffect(() => {
    const st = useStore.getState()
    const ctx: LocateCtx = { tabs: st.tabs, frames: st.canvas.frames, projects: st.projects }
    for (const ptyId of attentionPtys) {
      if (fetched.current.has(ptyId)) continue
      fetched.current.add(ptyId)
      const loc = locateForIsland(ptyId, ctx)
      if (!loc?.cwd) continue
      void window.api.session
        .last(loc.cwd, loc.sessionId)
        .then((r) => {
          if (!r.found) return
          setDetails((d) => ({ ...d, [ptyId]: { ask: r.ask, answer: r.answer, at: r.at } }))
        })
        .catch(() => {
          /* 读不到就只显示项目名和耗时，不影响通知本身 */
        })
    }
    // 提醒消除后允许下次重新读（同一个终端会反复完成任务）
    for (const id of [...fetched.current]) {
      if (!attentionPtys.includes(id)) {
        fetched.current.delete(id)
        setDetails((d) => {
          if (!(id in d)) return d
          const { [id]: _drop, ...rest } = d
          return rest
        })
      }
    }
  }, [attentionPtys])

  // stale 是拿「现在」和写回时刻比出来的，而推送只在状态变化时发生——
  // 什么都不变的话这 1.5 秒过去了也没人重算。这里补一次定时重推。
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!Object.keys(approvalSentAt).length) return
    const t = setTimeout(() => setTick((x) => x + 1), STALE_MS + 100)
    return () => clearTimeout(t)
  }, [approvalSentAt])

  // 聚合 + 节流推送。
  //
  // **必须是节流，不能是防抖。** 一开始写成了「每次依赖变化就 clearTimeout 重排 250ms」，
  // 那是防抖——而 agent 干活时终端标题里的盲文 spinner 每 ~100ms 换一个字符，
  // setTabTitle 每次都产生新的 tabs 数组，依赖便一直在变，250ms 的静默窗口**永远等不到**。
  // 后果：另一个终端早就答完了，灵动岛却一点动静没有（不弹卡、未读数不涨），
  // 非要等最后一个终端也停下来，攒了一堆通知才一起冒出来。
  // 改成节流后，无论依赖变多快，最多 PUSH_MS 就必然推一帧。
  useEffect(() => {
    const push = (): void => {
      lastPush.current = Date.now()
      const st = useStore.getState()
      const ctx: LocateCtx = { tabs: st.tabs, frames: st.canvas.frames, projects: st.projects }
      const raw = { runningPtys, attentionPtys, ptyApproval, ptyTiming }
      const running: IslandRunning[] = []
      for (const ptyId of runningPtys) {
        // 判据走 statusOf，不再直接把 runningPtys 当结论：这一行今天恒等
        // （statusOf 第一句就是 running 优先），写成这样是为了「谁在跑」在整个应用里
        // 只有一个说法——以后 running 的判据一旦变了，这里跟着变，不会掉队。
        if (statusOf(ptyId, raw) !== 'running') continue
        const loc = locate(ptyId, ctx)
        if (!loc) continue
        running.push({
          key: ptyId,
          project: loc.project,
          term: loc.term,
          startedAt: ptyTiming[ptyId]?.roundStart ?? Date.now()
        })
      }

      const notices: IslandNotice[] = []
      for (const ptyId of attentionPtys) {
        // kind 走 machine.attentionKindOf，不再在这里第二次写 `ap ? 'approval' : 'done'`。
        //
        // **刻意用 attentionKindOf 而不是 statusOf**：statusOf 里 running 优先，
        // 而「还在跑但 agent 叫了你一声」（onBell / MCP notify）是真实且常见的情形，
        // 按 statusOf 判会让这类通知整条消失——灵动岛是它目前**唯一**还看得见的地方
        // （另外五个面都按 top !== 'running' 过滤，见本轮报告里那条待立项的跟进）。
        // 这也意味着这样一个 pty 会同时出现在「运行中」和通知卡里：那是对的，
        // 两个区讲的是两件事——一个是它在干活，一个是它有话对你说。
        const kind = attentionKindOf(ptyId, raw)
        if (!kind) continue
        const loc = locateForIsland(ptyId, ctx)
        if (!loc) continue
        const d = details[ptyId]
        const t = ptyTiming[ptyId]
        const ap = ptyApproval[ptyId]
        // 写回之后 spinner 没在 1.5s 内重新转起来 = 那一下没生效（多半解析认错了行）。
        // 这时候不能继续把按钮摆在那儿让人反复点，降级成「跳回终端」。
        const sentAt = approvalSentAt[ptyId]
        const stale = !!sentAt && Date.now() - sentAt > STALE_MS && !runningPtys.includes(ptyId)
        notices.push({
          // id 带上耗时：同一个终端第二次完成时 id 会变，灵动岛据此知道「这是新的一条」
          id: `${ptyId}:${t?.lastRoundMs ?? 0}`,
          kind,
          project: loc.project,
          term: loc.term,
          ask: d?.ask,
          answer: d?.answer,
          roundMs: t?.lastRoundMs,
          totalMs: t?.firstAt ? Date.now() - t.firstAt : undefined,
          model: loc.model,
          effort: loc.effort,
          agent: loc.agent,
          // 优先用 transcript 里那轮对话的时间；没有（Codex / 读不到）就用本轮结束时刻。
          // **不能退化成 Date.now()**：那样每帧重算，同一帧里所有通知时间戳相同，
          // 「新的排前面」这条排序规则等于失效。
          at: d?.at || t?.lastDoneAt || Date.now(),
          question: ap?.question,
          body: ap?.body,
          options: ap?.options,
          dangerous: ap?.dangerous,
          stale
        })
      }

      // 队列顺序：等审批的排前面——那是 agent 卡在那儿动不了，
      // 而「答完了」只是条通报，晚看一会儿没有代价。同类里新的在前。
      // 这两句话正是 machine.urgencyCmp 的口径，原来这里手写了一遍，是第二份定义；
      // 现在直接用那一份，抽屉的待处理列表、抽屉项目行排的也是它。
      notices.sort((a, b) => urgencyCmp(a.kind, a.at, b.kind, b.at))

      // 点过「知道了」的不再往岛上推。**注意 attention 没动** ——
      // 软件内部（侧栏红点 / 抽屉呼吸 / 标题栏铃铛）照旧显示待处理，
      // 只是岛不再为它冒出来。真正消掉要等你去那个终端。
      const allIds = notices.map((n) => n.id)
      const shown = notices.filter((n) => !silencedNotices.includes(n.id))
      // 顺手把已经不存在的静音项摘掉：终端下一轮完成会生成新 id，
      // 旧 id 留着只是白占地方（而且会随使用无限增长）
      useStore.getState().pruneSilenced(allIds)

      const state: IslandState = { running, notices: shown }
      window.api.island.sync(state)
    }

    // 每次渲染都把最新的 push 挂上去，尾推到点时取的就是这份
    pushRef.current = push

    // 距上次推送够久了就立刻推，否则安排一次「补齐到 PUSH_MS」的尾推。
    // 关键在于这里**不清除已排队的尾推**——清了就退化回防抖。
    const since = Date.now() - lastPush.current
    if (since >= PUSH_MS) {
      push()
      return
    }
    if (timer.current) return // 已经有一次尾推在路上，它会经 pushRef 取到最新状态
    timer.current = setTimeout(() => {
      timer.current = null
      pushRef.current()
    }, PUSH_MS - since)
    return
  }, [
    runningPtys,
    attentionPtys,
    silencedNotices,
    tabs,
    projects,
    frames,
    ptyTiming,
    details,
    ptyApproval,
    approvalSentAt,
    tick
  ])

  // 灵动岛回传的动作
  useEffect(() => {
    return window.api.island.onAction((a: IslandAction) => {
      const st = useStore.getState()
      if (a.type === 'dismiss') {
        // 「知道了」**不等于处理完了**：只让灵动岛别再为这一条冒出来，
        // 终端的待处理标记留着，等你真去那个终端才消。
        // （原来这里是 clearAttention，等于点一下就把任务当成看过了，
        //   于是「我知道有这回事，但还没空处理」这种最常见的状态没法表达。）
        st.silenceNotice(a.key)
        return
      }
      if (a.type === 'approve') {
        const ap = st.ptyApproval[a.key]
        if (!ap) return
        // 危险命令在 UI 上就没有按钮，这里再挡一道：动作是跨进程来的，
        // 不能假设发它的那一端一定守规矩。
        if (ap.dangerous) return
        // 只接受确实出现在屏幕上的序号。少了这一句，一个越界的 choice
        // 就会被原样敲进 CLI，等于替用户瞎按。
        if (typeof a.choice !== 'number' || !ap.options.some((o) => o.index === a.choice)) return
        const ctx: LocateCtx = { tabs: st.tabs, frames: st.canvas.frames, projects: st.projects }
        if (!locate(a.key, ctx)) return // 终端已经关了
        window.api.pty.write(a.key, `${a.choice}\r`)
        st.markApprovalSent(a.key)
        return
      }
      if (a.type !== 'focus') return
      // 原来这里独立实现了一遍「跳过去 + 清状态」：判断条件是
      // `viewMode === 'canvas' && loc.frameId && loc.nodeId`，把「我在哪个模式」和
      // 「这个终端有没有画布节点」混成了一个条件，还在最上面就先 clearAttention。
      // 画布模式下点一个没有画布节点的终端（⌘T/侧栏/抽屉双击开的都是这种，主流情况）
      // 会落进 else 分支，但那一支不切 viewMode，Sidebar/TabBar 依旧不挂载——
      // 提醒已经消了，画面却毫无变化。focusTerminal（见 useStatus.ts）把这两个判断
      // 分开了，且先保证目标可见再清，两套实现的分歧点正是这里，改用它而不是自己再写一遍。
      focusTerminal(a.key)
    })
  }, [])
}
