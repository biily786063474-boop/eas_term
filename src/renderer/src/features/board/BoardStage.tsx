// 看板视图：按项目状态分列，一个项目一张卡片，卡片里嵌一个**真的能用的终端**。
//
// 和画布共用同一批 leaf —— 终端只有一份，切视图不重挂载（见 PaneLayer 顶部说明）。
// 这里只画卡片骨架和那个空的「终端槽位」，终端本体由 PaneLayer 量着槽位的位置浮上来。
// 为什么不把终端直接渲染进卡片：那样切一次视图就换一次父容器，xterm 会重挂载，
// 滚动缓冲和正在跑的会话全丢。
//
// 状态标签是**项目**的属性（shared/types 的 ProjectStatus），不是画布 Frame 的 ——
// 所以这里拖一张卡片改的是项目状态，画布那边的 Frame 配色会跟着变，反过来也一样。
import { useMemo, useState } from 'react'
import { useStore } from '../../store'
import { collectLeaves } from '../../layout'
import type { LeafNode } from '../../layout'
import type { Project, ProjectStatus } from '../../../../shared/types'
import { FRAME_STATUS_LIST } from '../canvas/frameStatus'
import { CanvasRunMonitor } from '../canvas/CanvasRunMonitor'
import { TerminalIcon, PlusIcon } from '../../ui/Icons'
import './board.css'

/** 列 = 三个状态 + 一列「未分类」。
 *  未分类不是第四种状态，是「还没标」—— 所以 key 用 null，不给它编个 'none' 值，
 *  否则存档里就会出现一个和 undefined 语义重复的字符串。 */
const COLUMNS: { key: ProjectStatus | null; label: string }[] = [
  ...FRAME_STATUS_LIST,
  { key: null, label: '未分类' }
]

interface TermLeaf {
  leaf: LeafNode
  ptyId: string
  title: string
}

export function BoardStage(): JSX.Element {
  const projects = useStore((s) => s.projects)
  const tabs = useStore((s) => s.tabs)
  const setProjectStatus = useStore((s) => s.setProjectStatus)
  const boardLeafByProject = useStore((s) => s.boardLeafByProject)
  const setBoardLeaf = useStore((s) => s.setBoardLeaf)
  const attentionPtys = useStore((s) => s.attentionPtys)
  const runningPtys = useStore((s) => s.runningPtys)
  const openTerminal = useStore((s) => s.openTerminal)
  const setActiveProject = useStore((s) => s.setActiveProject)

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
        arr.push({ leaf, ptyId: leaf.pane.ptyId, title: t.title })
        m.set(t.projectId, arr)
      }
    }
    return m
  }, [tabs])

  const byCol = (key: ProjectStatus | null): Project[] =>
    projects.filter((p) => (p.status ?? null) === key)

  const drop = (key: ProjectStatus | null): void => {
    if (dragId) void setProjectStatus(dragId, key)
    setDragId(null)
    setOverCol(null)
  }

  return (
    <div className="board">
      {/* 会话进行队列：跟画布共用同一个组件 —— 它只读 store 里「谁在跑」，
          和画布几何无关。两个视图各写一份的话，「哪些算在跑」的判据迟早分叉 */}
      <CanvasRunMonitor />
      {COLUMNS.map((col) => {
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
              <span className="board-coldot" />
              <span className="board-collabel">{col.label}</span>
              <span className="board-colcount">{list.length}</span>
            </div>
            <div className="board-list">
              {list.length === 0 && (
                <div className="board-empty">{overCol === colId ? '放这里' : '空'}</div>
              )}
              {list.map((p) => {
                const terms = termsByProject.get(p.id) ?? []
                const curId = boardLeafByProject[p.id]
                // 记着的那个可能已经被关掉了 → 回落到第一个，而不是留个空槽位
                const cur = terms.find((t) => t.leaf.id === curId) ?? terms[0]
                const busy = terms.some((t) => runningPtys.includes(t.ptyId))
                const need = terms.some((t) => attentionPtys.includes(t.ptyId))
                return (
                  <div
                    key={p.id}
                    className={`board-card${dragId === p.id ? ' dragging' : ''}`}
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
                    onMouseDown={() => setActiveProject(p.id)}
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
                      {terms.length > 1 && (
                        <select
                          className="board-pick"
                          value={cur?.leaf.id ?? ''}
                          data-tip="这个项目开了多个终端，选一个显示"
                          onChange={(e) => setBoardLeaf(p.id, e.target.value)}
                          onMouseDown={(e) => e.stopPropagation()}
                        >
                          {terms.map((t, i) => (
                            <option key={t.leaf.id} value={t.leaf.id}>
                              {t.title || `终端 ${i + 1}`}
                            </option>
                          ))}
                        </select>
                      )}
                      {terms.length > 1 && <span className="board-termn">{terms.length}</span>}
                    </div>

                    {cur ? (
                      // 空的：PaneLayer 量它的位置，把真终端浮上来。
                      // data-leaf 是给 PaneLayer 认的，别改名
                      <div className="board-slot" data-leaf={cur.leaf.id} />
                    ) : (
                      <button
                        className="board-noterm"
                        onClick={() => void openTerminal({ projectId: p.id })}
                      >
                        <TerminalIcon size={14} />
                        还没有终端，开一个
                      </button>
                    )}

                    {!!cur && (
                      <div className="board-cardft">
                        <button
                          className="board-add"
                          data-tip="在这个项目再开一个终端"
                          onClick={() => void openTerminal({ projectId: p.id })}
                        >
                          <PlusIcon size={11} />
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
