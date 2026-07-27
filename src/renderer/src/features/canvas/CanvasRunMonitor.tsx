// 画布右上角的「运行监视窗」：列出此刻在无人值守跑 agent 任务的终端。
//
// 刻意做得很淡：它是余光里的一条信息（「哦，那两个还在跑」），不是要你处理的通知——
// 需要处理的事有标题栏铃铛，两者不该抢注意力。鼠标移上去才提亮。
// 没有任务时整个组件不渲染，一个像素都不占。
import { useMemo, useState } from 'react'
import { useStore } from '../../store'
import { collectLeaves } from '../../layout'

/** 终端名只留前 5 个字。先剥掉开头的盲文 spinner（⠋⠙⠹…）——
 *  agent 干活时会把转圈字符写进标题，不剥的话五个字要被它占掉一个还难看。 */
function shortName(s: string): string {
  const t = s.replace(/^[⠀-⣿\s]+/u, '').trim()
  return t.length > 5 ? t.slice(0, 5) + '…' : t
}

interface Row {
  ptyId: string
  leafId: string
  frameId?: string
  nodeId?: string
  project: string
  term: string
}

export function CanvasRunMonitor(): JSX.Element | null {
  const runningPtys = useStore((s) => s.runningPtys)
  const tabs = useStore((s) => s.tabs)
  const projects = useStore((s) => s.projects)
  const frames = useStore((s) => s.canvas.frames)
  const maximizedNode = useStore((s) => s.maximizedNode)
  const focusCanvasNode = useStore((s) => s.focusCanvasNode)
  const [collapsed, setCollapsed] = useState(false)

  const rows = useMemo<Row[]>(() => {
    if (!runningPtys.length) return []
    const running = new Set(runningPtys)
    const out: Row[] = []
    for (const t of tabs) {
      for (const leaf of collectLeaves(t.root)) {
        if (leaf.pane.kind !== 'terminal') continue
        const ptyId = leaf.pane.ptyId
        if (!running.has(ptyId)) continue
        // 终端名优先取画布节点的自定义名（用户自己起的），否则用标签名
        const frame = frames.find((f) => f.nodes.some((n) => n.leafId === leaf.id))
        const node = frame?.nodes.find((n) => n.leafId === leaf.id)
        out.push({
          ptyId,
          leafId: leaf.id,
          frameId: frame?.id,
          nodeId: node?.id,
          project: projects.find((p) => p.id === t.projectId)?.name ?? '未归属',
          term: shortName(node?.name || t.title || '终端')
        })
      }
    }
    return out
  }, [runningPtys, tabs, projects, frames])

  if (!rows.length) return null
  if (maximizedNode) return null // 最大化时让位（沉浸式）

  if (collapsed) {
    return (
      <button
        className="crm-mini"
        data-tip={`${rows.length} 个任务进行中，点击展开`}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() => setCollapsed(false)}
      >
        <span className="crm-dot" />
        {rows.length}
      </button>
    )
  }

  return (
    <div className="crm" onMouseDown={(e) => e.stopPropagation()}>
      <div className="crm-head">
        <span className="crm-dot" />
        <span className="crm-title">任务进行中 {rows.length}</span>
        <button className="crm-fold" data-tip="收起" onClick={() => setCollapsed(true)}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
      </div>
      <div className="crm-list">
        {rows.map((r) => (
          <button
            key={r.ptyId}
            className="crm-row"
            data-tip={`${r.project} · ${r.term} —— 点击聚焦到这个终端`}
            onClick={() => {
              if (r.frameId && r.nodeId) focusCanvasNode(r.frameId, r.nodeId)
            }}
          >
            <span className="crm-proj">{r.project}</span>
            <span className="crm-sep">·</span>
            <span className="crm-term">{r.term}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
