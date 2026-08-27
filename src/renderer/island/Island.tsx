// 灵动岛的三个形态：折叠条 / 通知卡 / 运行列表。
//
// 三态共用**同一个黑块外壳**：展开是它长高，不是它下面又浮出一张卡片。
// 一开始做成了「顶上一条 + 下面一张卡」，中间还留了道透明缝想让刘海透出来，
// 结果缝里露的是壁纸，整体断成几截。形态的连贯靠的就是这一个外壳。
//
// 渐进式披露的分工：折叠态只回答「要不要管」，展开态才回答「管什么」。
// 每一层只说上一层没说过的——顶行已经写了「3 个项目」，列表里就不再重复总数。
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { IslandNotice, IslandState } from '../../shared/types'

type Mode = 'collapsed' | 'notice' | 'list'

/** 「回答结束」类通知的停留时长。审批类不会走这个定时器——
 *  agent 正阻塞着等人，自动收走等于把任务弄丢。 */
const AUTO_HIDE_MS = 8000

declare global {
  interface Window {
    island: {
      onState: (cb: (s: IslandState) => void) => () => void
      ready: () => void
      reportSize: (w: number, h: number) => void
      onLeave: (cb: () => void) => () => void
      onEnter: (cb: () => void) => () => void
      action: (a: {
        type: 'focus' | 'dismiss' | 'approve' | 'mini' | 'unmini'
        key: string
        choice?: number
      }) => void
    }
  }
}

/** 毫秒 → 「2分14秒」。超过一小时才带小时，否则分钟数会被压缩得没法比较 */
function fmtDur(ms?: number): string {
  if (!ms || ms < 0) return '—'
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}秒`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}分${String(s % 60).padStart(2, '0')}秒`
  return `${Math.floor(m / 60)}时${String(m % 60).padStart(2, '0')}分`
}

export function Island(): JSX.Element | null {
  const [st, setSt] = useState<IslandState>({ running: [], notices: [] })
  const [mode, setMode] = useState<Mode>('collapsed')
  /** 当前正在看哪一条通知——记 **id 而不是数组下标**。
   *  队列是按「审批优先、同类新的在前」排序的，新通知会插到前面，
   *  下标会因此指向另一条：你读到一半，内容被换成刚到的那条。 */
  const [viewId, setViewId] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  /** 正在播退场动画（主进程马上要销毁这个窗口） */
  const [leaving, setLeaving] = useState(false)
  /** 已经点过选项、正在等 CLI 响应的那条审批的 id。
   *
   *  **不加这个会替用户多按一次。** 点完选项后卡片不会立刻变（下一帧推送最快 250ms，
   *  stale 判定要 1.5s），按钮还亮着；用户以为没点上再点一次，第二个数字就被写进 pty。
   *  这时 CLI 的对话框已经被第一下消费掉了，第二个数字会落进 agent 的输入并带回车提交——
   *  等于凭空替用户发了一条内容为「1」的指令，或者自动通过了下一个审批框。 */
  const [sentId, setSentId] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  /** 已经自动弹过的通知 id。
   *  **必须是集合，不能只记最后一条。** 只记一条时：A 弹过→用户收起→B 插队弹出→
   *  B 被清掉后队首退回 A，而 ref 里存的是 B，A 就被当成没见过的重新弹一遍——
   *  用户会看到灵动岛自己弹开、显示一条十分钟前读完并手动收起过的旧通知。 */
  const popped = useRef(new Set<string>())
  /** 当前 mode 的镜像。给 effect 读用——把 mode 放进依赖数组会引发下面那个自杀链路。 */
  const modeRef = useRef(mode)
  modeRef.current = mode
  /** 主窗口在不在前台。同样用 ref：它每帧都可能变，进依赖数组会把弹出判断搅乱 */
  const fgRef = useRef(false)
  fgRef.current = !!st.foreground

  useEffect(() => {
    const off = window.island.onState(setSt)
    window.island.ready() // 监听器挂好了才要状态，顺序反了就会丢首帧
    return off
  }, [])

  // 进/退场。窗口的生死由主进程掌握，这里只负责在它销毁窗口之前把动画播完。
  useEffect(() => {
    const offLeave = window.island.onLeave(() => setLeaving(true))
    const offEnter = window.island.onEnter(() => setLeaving(false))
    return () => {
      offLeave()
      offEnter()
    }
  }, [])

  // 秒表自己走，不靠推送刷新：否则秒数跳动的节奏就等于推送节奏，看着像卡住
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  // 新通知到达 → 自动展开。
  // 「答完了」是条信息，停 8 秒就收；「等你审批」是 agent 卡在那儿，**不自动收**——
  // 自动收走等于把一个正在阻塞的任务藏起来，用户以为没事了，其实它一直在等。
  // 找**第一条还没弹过的**，而不是只看队首。
  //
  // 只看 notices[0] 是不行的：队列按「审批优先、同类按 at 倒序」排，而同一帧里
  // 多条通知的 at 可能相等（拿不到 transcript 时间时会退化成同一个时间戳），
  // 排序稳定 → 先产生的那条一直占着队首。它早就在「弹过」集合里，
  // 后来的新通知就永远轮不到自动弹出——实测未读数涨到 2 也没弹。
  const pending = st.notices.find((n) => !popped.current.has(n.id)) ?? null
  const headId = pending?.id ?? null
  const headKind = pending?.kind ?? null
  useEffect(() => {
    if (!headId || popped.current.has(headId)) return
    // 先记下「这条见过了」，不管弹不弹。否则等你手动折叠之后，
    // 这条旧通知会被当成新的重新弹出来。
    popped.current.add(headId)
    // **正在读一条通知时不打断。** 你读着 A，后台又完成一个任务——
    // 这时把卡片跳到新那条、还重置计时，等于把人从阅读里踢出去。
    // 新的那条已经进了队列，右上角计数会变成 1/2，翻过去看就行。
    //
    // 只挡 notice 态：list 态没有任何「正在读的内容」，开着运行列表等结果的人
    // 恰恰最需要看到通知弹出来。审批类则一律抢过来——agent 卡着等人。
    if (modeRef.current === 'notice' && headKind !== 'approval') return
    // **前台时「任务完成」只折叠着播报，「等审批」才自动摊开。**
    //
    // 分界线是「这条通知要不要你做决定」：
    //   · 任务完成 —— 只是通报。卡片 400+ 像素宽、好几行高，还挂在 screen-saver 层级，
    //     你正干着活它就压掉屏幕顶部一大块。折叠条写着「任务完成」够了，想看点开。
    //   · 等待审批 —— agent 卡在那儿动不了，而且卡片上就有能直接点的选项按钮，
    //     摊开它等于把「处理掉」这件事送到手边；只折叠的话你还得点开才发现有得选。
    if (fgRef.current && headKind !== 'approval') return
    setViewId(headId)
    setMode('notice')
  }, [headId, headKind])

  // 自动收起单独成一个 effect，**不能和「决定弹不弹」写在一起**。
  //
  // 合在一起时必然自杀：那个 effect 里 setMode('notice') 会让 mode 变化 →
  // 依赖数组变化 → React 先执行上一轮的 cleanup（clearTimeout 掉刚建的定时器）→
  // 再跑 effect 体时被 popped 守卫提前 return，不再重建。
  // 结果是 8 秒自动收起永远不触发，通知卡永久挂在屏幕顶上（这窗口还是
  // screen-saver 层级、盖全屏应用的）。
  //
  // 依赖只放三个**标量**：mode、viewId、当前这条的 kind。
  // 千万别把 st.notices 放进来——它每 250ms 就是一个新数组，定时器会被无限重置。
  const curKind =
    mode === 'notice'
      ? (st.notices.find((x) => x.id === viewId) ?? st.notices[0])?.kind ?? null
      : null
  useEffect(() => {
    // 审批类不自动收：agent 正阻塞着等人，收走等于把任务藏起来
    if (mode !== 'notice' || !curKind || curKind === 'approval') return
    const t = setTimeout(() => setMode('collapsed'), AUTO_HIDE_MS)
    return () => clearTimeout(t)
  }, [mode, viewId, curKind])

  // 通知被处理光了 → 回折叠态，并允许下一轮重新弹
  useEffect(() => {
    if (st.notices.length === 0) {
      popped.current.clear()
      setViewId(null)
      if (mode === 'notice') setMode('collapsed')
      return
    }
    // 把已经不在队列里的 id 从「弹过」集合里摘掉，否则它会随终端反复完成任务无限增长
    const live = new Set(st.notices.map((x) => x.id))
    for (const id of [...popped.current]) if (!live.has(id)) popped.current.delete(id)
  }, [st.notices, mode])

  // 展开着就别让主进程把窗口收走 —— 前台的露面窗口期只有 9 秒，
  // 没这一下的话，正读着的列表会当着你的面消失。
  useEffect(() => {
    window.island.hold(mode !== 'collapsed')
  }, [mode])

  // 点到岛以外的地方就收起来。岛是 focusable:false 的窗口，自己收不到 blur，
  // 由主进程在别的窗口拿到焦点时通知（见 island.ts 的 browser-window-focus）
  useEffect(() => window.island.onCollapse(() => setMode('collapsed')), [])

  // 把自己的实际尺寸报给主进程，由它摆窗口。窗口大小跟着内容走，
  // 就不用在主进程里维护一份「每种形态多大」的魔法数字表。
  useLayoutEffect(() => {
    const el = rootRef.current
    if (!el) return
    const report = (): void => {
      const r = el.getBoundingClientRect()
      window.island.reportSize(Math.ceil(r.width), Math.ceil(r.height))
    }
    report()
    const ro = new ResizeObserver(report)
    ro.observe(el)
    return () => ro.disconnect()
    // st.mini 必须在依赖里：切形态时整棵子树换掉，rootRef 指向的是新节点，
    // 不重新 observe 的话 ResizeObserver 还盯着已经卸载的那个
  }, [mode, st.mini, st.notices.length, st.running.length])

  const unread = st.notices.length
  const projectCount = new Set(st.running.map((r) => r.project)).size
  // 刘海尺寸由主进程量好下发。w=0 = 这块屏没有刘海 → 不贴顶，也不留中间那段
  const notchW = st.notch?.w ?? 0
  const barH = st.notch?.h ? st.notch.h : 30
  const pinned = notchW > 0

  const focus = (key: string): void => {
    window.island.action({ type: 'focus', key })
    setMode('collapsed')
  }

  const toggle = (): void => {
    // 不用手动清自动收起的定时器：它挂在 mode 上，mode 一变 effect 的 cleanup 就收掉了
    if (mode !== 'collapsed') {
      setMode('collapsed')
      return
    }
    // **一律进列表**，审批也不例外。
    //
    // 从折叠条点开只做「展开」这一件事：一眼看清哪些完成了、哪些还在跑，
    // 不改动任何状态（不清待处理、不把通知标成已读）——那些要等你点进某一条。
    // 原来有审批时会直接摊开那张卡，于是「我只想看看都完成了什么」这个最常见的
    // 动作，会被一张要你做决定的卡片拦住。审批在列表里标着「等审批」，
    // 点它照样跳回终端处理。
    setMode('list')
  }

  const waiting = st.notices.some((n) => n.kind === 'approval')
  const dotCls = waiting ? 'wait' : st.running.length ? 'live' : 'idle'
  const count = st.running.length ? `${projectCount} 个项目` : `${unread} 条`

  // 混合态（还有在跑的、同时有已完成没看的）是最常见的一种，得同时说清两件事。
  // 只靠右边那个琥珀徽标表达「有 N 条完成」需要用户先学会它的含义，
  // 而折叠条大多数时候是灵动岛唯一露在外面的部分，不该有需要学的东西。
  const runN = st.running.length
  const doneN = st.notices.filter((n) => n.kind === 'done').length
  const mixed = !waiting && runN > 0 && doneN > 0
  // 折叠条大多数时候是灵动岛唯一露在外面的部分，尤其前台时它就是全部 ——
  // 所以这一句必须自己说清是哪种事，不能只写「待处理」让人再点开确认
  const label = waiting ? '需要审批' : runN ? '工作中' : doneN > 0 ? '任务完成' : '待处理'

  /** 顶行：三态都在，位置和高度都不变。
   *  贴顶时中间空出刘海那段不放字——刘海要真在那儿，放了也看不见。 */
  // 状态类同时决定配色和 hover 反馈方式（见 island.css 的三段 hover 规则）
  const rowState = waiting ? 'waiting' : st.running.length ? 'working' : 'idle'
  const topRow = (
    <div className={`isl-toprow ${rowState}`} style={{ height: barH }} onClick={toggle}>
      <div className="isl-ear left">
        <span className={`isl-dot ${dotCls}`} />
        <span className="isl-earlabel">
          {mixed ? (
            <>
              {runN} 个在跑
              <span className="isl-labelsep">·</span>
              {/* 这一段固定琥珀色，不跟着 hover 扫光走——见 island.css 里的说明 */}
              <span className="isl-labeldone">{doneN} 完成</span>
            </>
          ) : (
            label
          )}
        </span>
      </div>
      {pinned ? <div className="isl-gap" style={{ width: notchW }} /> : <span className="isl-spacer" />}
      <div className="isl-ear right">
        {unread > 0 && <span className="isl-unread">{unread}</span>}
        <span className="isl-earcount">{count}</span>
      </div>
    </div>
  )

  // ── 收成一颗点（用户右键收起）────────────────────────────────────────
  // 常驻的一条黑块会压住顶部内容。收起后只留摄像头左边一颗呼吸的圆点，
  // **它仍然在跑**：颜色跟着状态走（等审批=琥珀、在跑=绿、闲=灰），
  // 有事的时候呼吸得更明显，点一下就展开回去。
  if (st.mini) {
    const miniCls = waiting ? 'waiting' : st.running.length ? 'working' : 'idle'
    const n = st.running.length + st.notices.length
    return (
      <div className="isl-root mini" ref={rootRef}>
        <button
          className={`isl-mini ${miniCls}`}
          data-tip="点开灵动岛"
          title={n ? `${n} 项进行中 · 点开` : '点开灵动岛'}
          onClick={() => window.island.action({ type: 'unmini', key: '' })}
        >
          <span className="isl-mini-core" />
          {n > 0 && <span className="isl-mini-n">{n > 9 ? '9+' : n}</span>}
        </button>
      </div>
    )
  }

  const shell = (children?: JSX.Element | null): JSX.Element => (
    <div
      className="isl-root"
      ref={rootRef}
      // 右键收成一颗点。**用 contextmenu 而不是加个关闭按钮**：
      // 顶行那条本来就窄，再塞一个 × 会把「有几个在跑」挤没；
      // 而收起是低频动作，藏在右键里正好。
      onContextMenu={(e) => {
        e.preventDefault()
        window.island.action({ type: 'mini', key: '' })
      }}
    >
      <div className={`isl-shell ${pinned ? 'pinned' : 'floating'} ${leaving ? 'leaving' : 'entering'}`}>
        {topRow}
        {children}
      </div>
    </div>
  )

  if (mode === 'notice' && st.notices.length > 0) {
    // 按 id 定位；找不到（你正看的那条已经被处理掉了）就回到队首
    const curIdx = Math.max(
      0,
      st.notices.findIndex((x) => x.id === viewId)
    )
    const n: IslandNotice = st.notices[curIdx]
    const ptyId = n.id.split(':')[0]
    const isApproval = n.kind === 'approval'
    // 能在这儿直接点的条件：认出了选项、不是危险命令、上一次写回也没失效、这条还没点过。
    // 四者缺一就不给按钮——绝不给一个可能按错、或者会被按第二次的按钮。
    const sent = sentId === n.id
    const canAct = isApproval && !!n.options?.length && !n.dangerous && !n.stale && !sent
    return shell(
      <div className={`isl-body${isApproval ? ' approval' : ''}`}>
        <div className="isl-head">
          <span className={`isl-dot ${isApproval ? 'wait' : 'done'}`} />
          <span className="isl-proj">{n.project}</span>
          <span className="isl-term">{n.term}</span>
          <span className="isl-spacer" />
          {st.notices.length > 1 && (
            // 计数可点 = 翻到下一条。多条挤在一起时，没有翻页入口的话
            // 后面几条只能等前面的处理完才看得见。
            <button
              className="isl-queue"
              title="看下一条"
              onClick={() => setViewId(st.notices[(curIdx + 1) % st.notices.length].id)}
            >
              {curIdx + 1}/{st.notices.length} ›
            </button>
          )}
          <span className={`isl-status ${isApproval ? 'wait' : 'done'}`}>
            {isApproval ? '等待审批' : '已完成'}
          </span>
        </div>

        {isApproval ? (
          <>
            {n.question && <div className="isl-ask">{n.question}</div>}
            {/* 待执行内容不截断——审批的正是这段字，看不全就没法判断 */}
            {n.body && <div className="isl-cmd">{n.body}</div>}
            {n.dangerous && (
              <div className="isl-warn">这条命令有破坏性，请回到终端确认完整上下文</div>
            )}
            {n.stale && !n.dangerous && (
              <div className="isl-warn">刚才那下没生效，可能选项认错了 —— 回终端处理</div>
            )}
            {/* 点完到 CLI 真正接手之间有几百毫秒空窗，不给反馈的话用户会以为没点上 */}
            {sent && !n.stale && <div className="isl-sent">已发送，等它接着跑…</div>}
          </>
        ) : (
          <>
            {n.ask && <div className="isl-ask">{n.ask}</div>}
            {n.answer && <div className="isl-answer">{n.answer}</div>}
            {/* 一个字都没读到时说明白为什么，别留一片空白让人以为是坏了 */}
            {!n.ask && !n.answer && (
              <div className="isl-nodetail">
                {n.agent === 'codex' ? 'Codex 不留会话记录，只能给到耗时' : '没读到这轮的会话记录'}
              </div>
            )}
          </>
        )}

        <div className="isl-meta">
          <span>{fmtDur(n.roundMs)}</span>
          {n.model && <span className="isl-metaitem">{n.model}</span>}
          {n.effort && <span className="isl-metaitem">{n.effort}</span>}
          {n.totalMs != null && <span className="isl-metaitem">会话 {fmtDur(n.totalMs)}</span>}
        </div>

        <div className="isl-actions">
          {canAct ? (
            n.options!.map((o) => (
              <button
                key={o.index}
                className={`isl-btn opt${o.index === 1 ? ' primary' : ''}`}
                title={o.label}
                onClick={() => {
                  window.island.action({ type: 'approve', key: ptyId, choice: o.index })
                  // 立刻锁住这条，别等下一帧推送——那要 250ms 起步，中间足够点第二下
                  setSentId(n.id)
                  // 还有别的在排队就留在展开态，并把视线推到下一条；
                  // 停在刚处理完那条上会让人以为没生效。
                  if (st.notices.length <= 1) setMode('collapsed')
                  else setViewId(st.notices[(curIdx + 1) % st.notices.length].id)
                }}
              >
                {o.label}
              </button>
            ))
          ) : (
            <button className="isl-btn primary" onClick={() => focus(ptyId)}>
              {isApproval ? '回终端处理' : '跳到这个终端'}
            </button>
          )}
          {!isApproval && (
            <button
              className="isl-btn"
              onClick={() => {
                // 「知道了」= 别再为这条冒出来。**不是「处理完了」** ——
                // 终端的待处理标记留着，等你真去那个终端才消。
                window.island.action({ type: 'dismiss', key: n.id })
                // 还有别的在排队就推到下一条；停在刚静音那条上会让人以为没生效。
                // （和上面 approve 的收尾保持一致，两处行为不同才是真的费解）
                if (st.notices.length <= 1) setMode('collapsed')
                else setViewId(st.notices[(curIdx + 1) % st.notices.length].id)
              }}
            >
              知道了
            </button>
          )}
        </div>
      </div>
    )
  }

  if (mode === 'list') {
    // 已完成的排在上面：它们是「要你处理」的，在跑的只是余光信息。
    // 点任意一条都直接跳到那个终端 —— 完成项跳过去看结果，运行项跳过去盯着。
    return shell(
      <div className="isl-body">
        {st.notices.length === 0 && st.running.length === 0 && (
          <div className="isl-empty">没有任务在跑</div>
        )}

        {st.notices.length > 0 && (
          <>
            <div className="isl-grouphd">完成了 {st.notices.length} 个</div>
            {st.notices.map((n) => {
              const ptyId = n.id.split(':')[0]
              const appr = n.kind === 'approval'
              return (
                <div key={n.id} className={`isl-row done${appr ? ' waiting' : ''}`} data-nid={n.id}>
                  <button className="isl-rowmain" onClick={() => focus(ptyId)}>
                    <span className={`isl-dot ${appr ? 'wait' : 'done'}`} />
                    <span className="isl-proj">{n.project}</span>
                    {/* 有这轮问的是什么就显示它，比终端名更能认出是哪件事 */}
                    <span className="isl-term">{n.ask || n.term}</span>
                    <span className="isl-spacer" />
                    <span className="isl-rowtime">{appr ? '等审批' : fmtDur(n.roundMs)}</span>
                  </button>
                  {/* 「知道了」：只让岛别再为这条冒出来，**待处理标记留着**。
                      审批类不给这个 —— agent 正卡着等人，静音等于把它藏起来。 */}
                  {!appr && (
                    <button
                      className="isl-rowmute"
                      title="知道了（仍留在待处理里）"
                      onClick={() => {
                        window.island.action({ type: 'dismiss', key: n.id })
                        // 这是最后一条的话就没什么可看的了，收起来
                        if (st.notices.length <= 1 && st.running.length === 0) setMode('collapsed')
                      }}
                    >
                      ✕
                    </button>
                  )}
                </div>
              )
            })}
          </>
        )}

        {st.running.length > 0 && (
          <>
            {st.notices.length > 0 && <div className="isl-grouphd">还在跑 {st.running.length} 个</div>}
            {st.running.map((r) => (
              <button key={r.key} className="isl-row" onClick={() => focus(r.key)}>
                <span className="isl-dot live" />
                <span className="isl-proj">{r.project}</span>
                <span className="isl-term">{r.term}</span>
                <span className="isl-spacer" />
                <span className="isl-rowtime">{fmtDur(now - r.startedAt)}</span>
              </button>
            ))}
          </>
        )}
      </div>
    )
  }

  return shell(null)
}
