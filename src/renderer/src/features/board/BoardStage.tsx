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
import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../../store'
import { collectLeaves } from '../../layout'
import type { LeafNode } from '../../layout'
import type { Project, ProjectStatus } from '../../../../shared/types'

import { CanvasRunMonitor } from '../canvas/CanvasRunMonitor'
import { useBoardScroll } from './useBoardScroll'
import { TerminalIcon, PlusIcon, CloseIcon, ChevronLeftIcon, TrashIcon } from '../../ui/Icons'
import './board.css'

interface TermLeaf {
  leaf: LeafNode
  ptyId: string
  title: string
  /** 关终端要 (tabId, leafId) 两个参数，收集时就带上，别到用的时候再去 tabs 里翻一遍 */
  tabId: string
}

export function BoardStage(): JSX.Element {
  const projects = useStore((s) => s.projects)
  const tabs = useStore((s) => s.tabs)
  const setProjectStatus = useStore((s) => s.setProjectStatus)
  const attentionPtys = useStore((s) => s.attentionPtys)
  const runningPtys = useStore((s) => s.runningPtys)
  const openTerminal = useStore((s) => s.openTerminal)
  const setActiveProject = useStore((s) => s.setActiveProject)
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

  /** 每个项目名下的终端 leaf。画布节点和分屏 tab 引用的是同一批 leaf，
   *  所以从 tabs 收一遍就够，不用再去 canvas.frames 里翻一遍（翻了还会重复） */
  const termsByProject = useMemo(() => {
    const m = new Map<string, TermLeaf[]>()
    for (const t of tabs) {
      if (!t.projectId) continue
      for (const leaf of collectLeaves(t.root)) {
        if (leaf.pane.kind !== 'terminal') continue
        const arr = m.get(t.projectId) ?? []
        arr.push({ leaf, ptyId: leaf.pane.ptyId, title: t.title, tabId: t.id })
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
    if (terms.length) setFull(terms[0].leaf.id)
    else void openTerminal({ projectId: p.id })
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
                  {t.title || `终端 ${i + 1}`}
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
            data-tip="关掉这个终端"
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
    <div className="board">
      {/* 会话进行队列：跟画布共用同一个组件 —— 它只读 store 里「谁在跑」，
          和画布几何无关。两个视图各写一份的话，「哪些算在跑」的判据迟早分叉 */}
      <CanvasRunMonitor />
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
                const busy = terms.filter((t) => runningPtys.includes(t.ptyId)).length
                const need = terms.filter((t) => attentionPtys.includes(t.ptyId)).length
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
                        data-tip={need ? '有终端在等你处理' : busy ? '有任务在跑' : ''}
                      />
                      <span className="board-cardname" data-tip={p.path}>
                        {p.name}
                      </span>
                      <span className="board-cardn" data-tip={`${terms.length} 个终端`}>
                        <TerminalIcon size={11} />
                        {terms.length}
                      </span>
                    </div>

                    {terms.length === 0 ? (
                      <div className="board-cardnone">还没有终端 · 点一下开一个</div>
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
                              }}
                            >
                              <span className="board-termdot" />
                              <span className="board-termname">{t.title || `终端 ${i + 1}`}</span>
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
                                data-tip="关掉这个终端"
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
  )
}
