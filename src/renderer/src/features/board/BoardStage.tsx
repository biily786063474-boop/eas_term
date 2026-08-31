// 看板视图：按项目状态分列，一个项目一张卡片。
//
// **卡片上不放终端** —— 卡片是摘要（项目名 / 状态 / 有几个终端 / 谁在等你），
// 点一下才铺满屏幕干活，退出回总览。早先试过把终端嵌进卡片：
// 四列并排，终端只剩两百来像素宽，字挤成一团，还得为每张卡片做一整套跟随定位。
// 看板的价值是「一眼看全」，不是「同时用四个终端」。
//
// 全屏那一个仍然走 PaneLayer 的槽位机制（不换父容器，xterm 不重挂载）——
// 三种视图共用一个 PaneView 实例，切来切去会话和滚动缓冲都在。
//
// 状态标签是**项目**的属性（shared/types 的 ProjectStatus），不是画布 Frame 的 ——
// 所以这里拖一张卡片改的是项目状态，画布那边的 Frame 配色会跟着变，反过来也一样。
import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../../store'
import { collectLeaves } from '../../layout'
import { edgeStep } from './edgeScroll'
import type { LeafNode } from '../../layout'
import type { Project, ProjectStatus } from '../../../../shared/types'

import { useProjectRows } from '../status/useStatus.ts'
import { useBoardScroll } from './useBoardScroll'
import { TerminalIcon, SparkleIcon, PlusIcon, CloseIcon, ChevronLeftIcon, TrashIcon } from '../../ui/Icons'
import './board.css'

interface TermLeaf {
  leaf: LeafNode
  /** **任务 id，不只是 pty id**：终端是 pty id，AI 对话是它的会话 id（sessionId）。
   *  两种不会撞（一个来自 node-pty，一个是 `ac-N`），而 attentionPtys / runningPtys
   *  本来就按这个 id 记账 —— 看板接 AI 对话进来不需要新的状态源，
   *  只是原来 `kind !== 'terminal'` 一句 continue 把它整类挡在门外了。
   *  判据同 status/machine.ts 的 locate()。 */
  ptyId: string
  title: string
  /** 关终端要 (tabId, leafId) 两个参数，收集时就带上，别到用的时候再去 tabs 里翻一遍 */
  tabId: string
  /** 卡片上要分得出这一行是终端还是 AI 对话（图标 + 空态文案都不一样） */
  kind: 'terminal' | 'agent'
}

export function BoardStage(): JSX.Element {
  const projects = useStore((s) => s.projects)
  const tabs = useStore((s) => s.tabs)
  const setProjectStatus = useStore((s) => s.setProjectStatus)
  // 卡片头「等处理/在跑」两个点判的是单个终端，就地读 attentionPtys/runningPtys 是合理的
  // 局部用途（同 AgentCmdBar）；卡片级别「这个项目要不要点」的聚合改走 rows，见下面 busy/need。
  const attentionPtys = useStore((s) => s.attentionPtys)
  const runningPtys = useStore((s) => s.runningPtys)
  const rows = useProjectRows()
  const openTerminal = useStore((s) => s.openTerminal)
  const setActiveProject = useStore((s) => s.setActiveProject)
  // 看板的「摆到眼前」是 setBoardFullscreen（把某一个终端全屏），既不是画布节点也不是
  // 分屏标签，走不了 focusTerminal 的那两支。所以这里自己调 clearAttention——
  // 但**只清真的被全屏出来的那一个**：setActiveProject 原来会顺手把整个项目清光，
  // 而卡片点进去只会全屏其中一个，其余的提醒就那么没了（见 projectsSlice.ts）。
  const clearAttention = useStore((s) => s.clearAttention)
  const full = useStore((s) => s.boardFullscreen)
  const setFull = useStore((s) => s.setBoardFullscreen)
  const columns = useStore((s) => s.boardColumns)
  const addBoardColumn = useStore((s) => s.addBoardColumn)
  const renameBoardColumn = useStore((s) => s.renameBoardColumn)
  const removeBoardColumn = useStore((s) => s.removeBoardColumn)
  const requestConfirm = useStore((s) => s.requestConfirm)
  // 关终端走和分屏/画布同一条路：杀 PTY + dispose xterm。
  // 它自己会在终端忙着时先弹确认，这里不用再判一遍
  const closeLeafSafely = useStore((s) => s.closeLeafSafely)
  /** 正在改名的列 id */
  const [editing, setEditing] = useState<string | null>(null)

  /** 用户自建的列 + 末尾一个虚拟的「未分类」。
   *  未分类不是一种状态，是「还没标」—— 它不存在于 board.json 里，
   *  所以 key 用 null，不给它编个 'none' 值和 undefined 语义打架。 */
  const cols: { key: ProjectStatus | null; label: string; color?: string }[] = [
    ...columns.map((c) => ({ key: c.id, label: c.name, color: c.color })),
    { key: null, label: '未分类' }
  ]

  // 滚轮接管（指针悬在哪都滚列）+ 滚上去的卡片折叠成一摞。全程不走 React。
  // 全屏时关掉：那会儿只有一个终端，没有列可滚
  useBoardScroll(!full)

  /** 拖动中的项目 id + 悬停在哪一列。列的 key 可能是 null，用一个哨兵字符串区分「没悬停」 */
  const [dragId, setDragId] = useState<string | null>(null)
  const [overCol, setOverCol] = useState<string | null>(null)

  // ── 拖到边缘自动滚（2026-08-30）──────────────────────────────────
  // 看板一屏正好四列，列多了往右滑。**没有自动滚的话，把卡片从第 1 列拖到
  // 第 6 列是做不到的** —— 手一直按着，没有第二只手去滚横向条。
  //
  // 两条轴都要：横向滚 `.board`（跨列），纵向滚指针底下那一列的 `.board-list`
  //（列里卡片多时同样够不着）。
  const boardRef = useRef<HTMLDivElement>(null)
  /** 拖拽时指针在哪。用 ref 不用 state —— 每次 dragover 都 setState 的话
   *  整个看板每秒重渲染几十次，而这个值只有滚动循环读 */
  const edgeAt = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    if (!dragId) return
    let raf = 0
    const tick = (): void => {
      raf = requestAnimationFrame(tick)
      const at = edgeAt.current
      const el = boardRef.current
      if (!at || !el) return
      const r = el.getBoundingClientRect()
      const dx = edgeStep(at.x, r.left, r.right)
      if (dx) el.scrollLeft += dx
      // 纵向滚的是指针底下那一列。**用 elementFromPoint 找** ——
      // 拖拽中 dragover 的 target 会在子元素间跳，靠它认列不稳
      const list = (document.elementFromPoint(at.x, at.y) as HTMLElement | null)?.closest(
        '.board-list'
      ) as HTMLElement | null
      if (list) {
        const lr = list.getBoundingClientRect()
        const dy = edgeStep(at.y, lr.top, lr.bottom)
        if (dy) list.scrollTop += dy
      }
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      edgeAt.current = null
    }
  }, [dragId])

  /** 每个项目名下的终端 leaf。画布节点和分屏 tab 引用的是同一批 leaf，
   *  所以从 tabs 收一遍就够，不用再去 canvas.frames 里翻一遍（翻了还会重复） */
  const termsByProject = useMemo(() => {
    const m = new Map<string, TermLeaf[]>()
    for (const t of tabs) {
      if (!t.projectId) continue
      for (const leaf of collectLeaves(t.root)) {
        const k = leaf.pane.kind
        if (k !== 'terminal' && k !== 'agent') continue
        // AI 对话还没起会话时 sessionId 是 undefined —— 那种没有状态可显示，跳过。
        // 不挡的话它会拿着 undefined 去 includes()，匹配不到任何东西，
        // 白占一行还永远是「静默」。
        const id = k === 'terminal' ? leaf.pane.ptyId : leaf.pane.sessionId
        if (!id) continue
        const arr = m.get(t.projectId) ?? []
        arr.push({ leaf, ptyId: id, title: t.title, tabId: t.id, kind: k })
        m.set(t.projectId, arr)
      }
    }
    return m
  }, [tabs])

  /** 全屏中的那个终端属于哪个项目（顶部条要显示项目名、要能切同项目的别的终端） */
  const fullOf = useMemo(() => {
    if (!full) return null
    for (const [pid, list] of termsByProject) {
      const hit = list.find((t) => t.leaf.id === full)
      if (hit) return { project: projects.find((p) => p.id === pid) ?? null, term: hit, list }
    }
    return null
  }, [full, termsByProject, projects])

  // Esc 退出全屏。**终端自己也吃 Esc**（要发给 CLI），所以焦点在终端里时不抢 ——
  // 正在跟 agent 对话时按 Esc 想中断它，结果整个退回看板，那就太粗暴了
  useEffect(() => {
    if (!full) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      const ae = document.activeElement as HTMLElement | null
      if (ae?.closest?.('.pane')) return
      e.preventDefault()
      setFull(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [full, setFull])

  // 全屏中的终端被关掉了（比如在别的视图里关的）→ 自动回总览，别卡在一片空白里
  useEffect(() => {
    if (!full) return
    const alive = [...termsByProject.values()].some((l) => l.some((t) => t.leaf.id === full))
    if (!alive) setFull(null)
  }, [full, termsByProject, setFull])

  const byCol = (key: ProjectStatus | null): Project[] =>
    projects.filter((p) => (p.status ?? null) === key)

  const drop = (key: ProjectStatus | null): void => {
    if (dragId) void setProjectStatus(dragId, key)
    setDragId(null)
    setOverCol(null)
  }

  /** 点开某个项目。有终端就全屏第一个，没有就先开一个（开完卡片上会出现它） */
  const openFull = (p: Project, terms: TermLeaf[]): void => {
    setActiveProject(p.id)
    // 供画布双击菜单的「最近使用」排序用（点看板卡片也是「打开这个项目」）
    useStore.getState().touchProject(p.id)
    if (terms.length) {
      setFull(terms[0].leaf.id)
      // 只清被全屏出来的这一个。同项目其它终端一个像素都没露面，它们的提醒得留着
      clearAttention(terms[0].ptyId)
    } else void openTerminal({ projectId: p.id })
  }

  if (fullOf) {
    return (
      <div className="board-fs">
        <div className="board-fs-hd">
          <button className="board-fs-back" onClick={() => setFull(null)}>
            <ChevronLeftIcon size={14} />
            看板
          </button>
          <span className="board-fs-name">{fullOf.project?.name ?? '终端'}</span>
          {/* 同一个项目开了多个终端：在这儿换，不用退回去再点 */}
          {fullOf.list.length > 1 && (
            <select
              className="board-fs-pick"
              value={full ?? ''}
              onChange={(e) => setFull(e.target.value)}
            >
              {fullOf.list.map((t, i) => (
                <option key={t.leaf.id} value={t.leaf.id}>
                  {t.title || (t.kind === 'agent' ? `AI 对话 ${i + 1}` : `终端 ${i + 1}`)}
                </option>
              ))}
            </select>
          )}
          <span className="board-fs-spacer" />
          <button
            className="board-fs-add"
            data-tip="在这个项目再开一个终端"
            onClick={() => fullOf.project && void openTerminal({ projectId: fullOf.project.id })}
          >
            <PlusIcon size={12} />
          </button>
          {/* 关掉当前这个终端（不是关窗口）。关完自动回总览 —— 
              那个终端已经没了，留在全屏里只会看到一片空白 */}
          <button
            className="board-fs-kill"
            data-tip={fullOf.term.kind === 'agent' ? '关掉这个 AI 对话' : '关掉这个终端'}
            onClick={() => {
              const cur = fullOf.term
              setFull(null)
              void closeLeafSafely(cur.tabId, cur.leaf.id)
            }}
          >
            <TrashIcon size={12} />
          </button>
          <button className="board-fs-x" data-tip="回看板（Esc）" onClick={() => setFull(null)}>
            <CloseIcon size={13} />
          </button>
        </div>
        {/* 空的：PaneLayer 量它的位置，把真终端浮上来。data-leaf 是给 PaneLayer 认的 */}
        <div className="board-slot board-fs-slot" data-leaf={full} />
      </div>
    )
  }

  return (
    <>
      {/* 这里曾经挂着 RunMonitor（会话进行队列）。**2026-08-26 撤掉**：
          它是 left:14px/top:14px 的绝对定位浮标，而看板的列标题就贴着容器顶边排，
          于是「3 个在跑」那个圆点正好压在第一列的标题上，把「待执行」遮掉半个字。
          画布那边保留 —— 画布内容可以平移，挡住了挪开就行；看板的列是固定网格，挪不开。

          撤掉不丢信息：看板模式下标题栏的待处理铃铛是挂载的
          （App.tsx 的 `viewMode !== 'canvas'`），「哪个终端在等你」在那儿看得到，
          卡片上也各自有小圆点。

          真要在这儿加回浮标的话，记住当初为什么它在 .board **外面**：
          .board 是横向滚动容器，absolute 放进去会相对它的 padding box 定位，
          横向滚看板时浮标跟着内容一起滑走。挪出来才是相对 .tab-stack 钉死。 */}
      <div
        className="board"
        ref={boardRef}
        // **在根容器上收 dragover**：拖拽经过任何一列都会冒到这里，
        // 而滚动要的是「指针在整块看板里的位置」，不是「在哪一列里」
        onDragOver={(e) => {
          e.preventDefault()
          edgeAt.current = { x: e.clientX, y: e.clientY }
        }}
      >
      {cols.map((col) => {
        const list = byCol(col.key)
        const colId = col.key ?? '_none'
        return (
          <div
            key={colId}
            className={`board-col${overCol === colId ? ' over' : ''}${col.key ? ` st-${col.key}` : ''}`}
            onDragOver={(e) => {
              // 不 preventDefault 的话 drop 根本不会触发 —— HTML5 拖放默认拒收
              e.preventDefault()
              setOverCol(colId)
            }}
            onDragLeave={(e) => {
              // 移到子元素上也会冒 dragleave，用 contains 挡掉，否则整列高亮一直在闪
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setOverCol(null)
            }}
            onDrop={() => drop(col.key)}
          >
            <div className="board-colhd">
              <span
                className="board-coldot"
                style={col.color ? { background: col.color, opacity: 1 } : undefined}
              />
              {/* `editing !== null` 这半句不能省：未分类列的 key 就是 null，
                  只写 `editing === col.key` 的话，没在改名时（editing 也是 null）
                  两个 null 相等 —— 那一列会一直杵着个改名输入框 */}
              {editing !== null && editing === col.key ? (
                <input
                  className="board-colrename"
                  defaultValue={col.label}
                  autoFocus
                  onBlur={(e) => {
                    void renameBoardColumn(col.key!, e.target.value)
                    setEditing(null)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                    if (e.key === 'Escape') setEditing(null)
                  }}
                />
              ) : (
                <span
                  className="board-collabel"
                  // 双击改名 —— 和侧栏项目行一个手势，不用再学一遍
                  onDoubleClick={() => col.key && setEditing(col.key)}
                  data-tip={col.key ? '双击改名' : '没打标签的项目都在这儿，删不掉也改不了名'}
                >
                  {col.label}
                </span>
              )}
              <span className="board-colcount">{list.length}</span>
              {/* 未分类是虚拟列，没有可删的东西 */}
              {col.key && (
                <button
                  className="board-coldel"
                  data-tip="删掉这个看板（里面的项目回到未分类，不会被删）"
                  onClick={() =>
                    requestConfirm({
                      message:
                        `删掉看板「${col.label}」？\n\n` +
                        (list.length
                          ? `里面的 ${list.length} 个项目会回到「未分类」，项目本身不受影响。`
                          : '这个看板现在是空的。'),
                      confirmLabel: '删掉',
                      onConfirm: () => void removeBoardColumn(col.key!)
                    })
                  }
                >
                  <TrashIcon size={11} />
                </button>
              )}
            </div>
            <div className="board-list">
              {list.length === 0 && (
                <div className="board-empty">{overCol === colId ? '放这里' : '空'}</div>
              )}
              {list.map((p) => {
                const terms = termsByProject.get(p.id) ?? []
                // 卡片级别的「要不要点」聚合走 rows（useProjectRows() 已按项目算好最急的状态），
                // 不再自己用 terms 数一遍——两边本就是同一份 tabs 算出来的，没必要算两次。
                // need/busy 这里只当布尔用（卡片描边、状态点颜色），不显示具体数字。
                const row = rows.find((r) => r.projectId === p.id)
                // need 判 attn（有几个终端在等你），不判 `top !== 'running'`——
                // 后者会漏掉「还在跑但响铃 / 调了 MCP notify」那类，而卡片**展开后**
                // 那一行的小圆点是就地读 attentionPtys 的（下面的 n），漏掉的话同一张卡
                // 会自相矛盾：里面写着「等处理」，卡片头却报「在跑」。
                const need = !!row && row.attn > 0
                const busy = row?.top === 'running'
                const termN = terms.filter((t) => t.kind === 'terminal').length
                const agentN = terms.length - termN
                return (
                  <div
                    key={p.id}
                    className={`board-card${dragId === p.id ? ' dragging' : ''}${need ? ' need' : ''}`}
                    draggable
                    onDragStart={(e) => {
                      setDragId(p.id)
                      e.dataTransfer.effectAllowed = 'move'
                      // Electron 里不塞点数据的话，某些平台会当成无效拖拽直接取消
                      e.dataTransfer.setData('text/plain', p.id)
                    }}
                    onDragEnd={() => {
                      setDragId(null)
                      setOverCol(null)
                    }}
                    onClick={() => openFull(p, terms)}
                  >
                    <div className="board-cardhd">
                      {/* 状态点：等处理 > 在跑 > 静默。三个状态挤一个点上，
                          因为卡片头就这么宽，两个点并排反而看不出哪个是哪个 */}
                      <span
                        className={`board-dot${need ? ' need' : busy ? ' busy' : ''}`}
                        data-tip={need ? '有终端或 AI 对话在等你处理' : busy ? '有任务在跑' : ''}
                      />
                      <span className="board-cardname" data-tip={p.path}>
                        {p.name}
                      </span>
                      {/* 终端和 AI 对话**分开计数**：合成一个数字看不出「这个项目
                          是开着终端还是在跟 AI 聊」，而那正是一眼扫看板时想知道的。
                          某一类为 0 就不显示那一格，别用「0」占位。 */}
                      {termN > 0 && (
                        <span className="board-cardn" data-tip={`${termN} 个终端`}>
                          <TerminalIcon size={11} />
                          {termN}
                        </span>
                      )}
                      {agentN > 0 && (
                        <span className="board-cardn agent" data-tip={`${agentN} 个 AI 对话`}>
                          <SparkleIcon size={11} />
                          {agentN}
                        </span>
                      )}
                    </div>

                    {terms.length === 0 ? (
                      <div className="board-cardnone">还没有终端或 AI 对话 · 点一下开一个</div>
                    ) : (
                      <div className="board-terms">
                        {/* 一个终端一行。那行字是终端标题 —— agent 干活时会把当前任务
                            写进标题，所以这行常常就直接告诉你「它在忙什么」 */}
                        {terms.slice(0, 3).map((t, i) => {
                          const n = attentionPtys.includes(t.ptyId)
                          const b = runningPtys.includes(t.ptyId)
                          return (
                            <button
                              key={t.leaf.id}
                              className={`board-term${n ? ' need' : b ? ' busy' : ''}`}
                              onClick={(e) => {
                                // 不挡住的话会连带触发卡片的 onClick，跳去第一个终端
                                e.stopPropagation()
                                setActiveProject(p.id)
                                setFull(t.leaf.id)
                                // 用户点的就是这一个终端，清它。原来这里指望
                                // setActiveProject 的批量清代劳，除了「点一个清一片」，
                                // 还有个更怪的后果：那个函数在项目**已经是当前项目**时
                                // 直接早退，于是点自己项目卡片里的终端反而一个都不清。
                                clearAttention(t.ptyId)
                              }}
                            >
                              <span className="board-termdot" />
                              {/* 一行里必须看得出是终端还是 AI 对话 —— 两者的标题
                                  都是「当前在忙什么」，光看文字分不出来 */}
                              <span className="board-termkind" data-kind={t.kind} aria-hidden>
                                {t.kind === 'agent' ? <SparkleIcon size={10} /> : <TerminalIcon size={10} />}
                              </span>
                              <span className="board-termname">
                                {t.title || (t.kind === 'agent' ? `AI 对话 ${i + 1}` : `终端 ${i + 1}`)}
                              </span>
                              {n && <em>等处理</em>}
                              {!n && b && <em>在跑</em>}
                              {/* 关掉这个终端。**看板原来没有这个入口** ——
                                  用完的终端得切回分屏或画布才能关，而每个常驻终端
                                  是一份不小的固定成本（填满 scrollback 约 75MB）。
                                  span 而不是 button：外面已经是 button 了，套不得 */}
                              <span
                                className="board-termx"
                                role="button"
                                tabIndex={-1}
                                data-tip={t.kind === 'agent' ? '关掉这个 AI 对话' : '关掉这个终端'}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  void closeLeafSafely(t.tabId, t.leaf.id)
                                }}
                              >
                                <CloseIcon size={10} />
                              </span>
                            </button>
                          )
                        })}
                        {terms.length > 3 && (
                          <div className="board-termmore">还有 {terms.length - 3} 个</div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
      {/* 新建看板。放最后一列后面 —— 它是「继续往右加」的动作，
          摆在左边或顶部都会让人以为是在给当前列做什么 */}
      <button className="board-addcol" onClick={() => void addBoardColumn()}>
        <PlusIcon size={14} />
        新看板
      </button>
      </div>
    </>
  )
}
