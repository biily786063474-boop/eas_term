// 画布**左上角**的「运行监视窗」：列出此刻在无人值守跑 agent 任务的终端。
// （实际定位见 canvas.css 的 `.crm { left: 14px; top: 14px }`。左右两侧是分工的：
//  右侧留给「完成 / 待处理」——标题栏铃铛、抽屉待处理气泡都在那边，
//  「进行中」挤过去会和它们抢注意力。这条注释本身写反过一次，
//  而说反左右正是当初「右上角通知不见了」那场事故的起因。）
//
// 刻意做得很淡：它是余光里的一条信息（「哦，那两个还在跑」），不是要你处理的通知——
// 需要处理的事有标题栏铃铛，两者不该抢注意力。鼠标移上去才提亮。
// 没有任务时整个组件不渲染，一个像素都不占。
import { useMemo, useState } from 'react'
import { useStore } from '../../store'
import { liveMaximizedNode } from '../../store/canvas/selectors'
import { locate } from './machine'

/** 终端名只留前 5 个字。
 *  **只截断，不剥 spinner**：进来的 l.term 已经被 machine.locate 里的 cleanTitle 洗过一遍，
 *  这里原来还自带一份更窄的剥离正则（只认盲文，不认 ✳✴✶✻✽✹◐◑◒◓◴◵◶◷*），
 *  功能上空转，留着只是同一件事的第二份实现——真要改剥离规则的人会改到不生效的那一份。 */
function shortName(s: string): string {
  const t = s.trim()
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

export function RunMonitor(): JSX.Element | null {
  const runningPtys = useStore((s) => s.runningPtys)
  const tabs = useStore((s) => s.tabs)
  const projects = useStore((s) => s.projects)
  const frames = useStore((s) => s.canvas.frames)
  const maximizedNode = useStore(liveMaximizedNode)
  const focusCanvasNode = useStore((s) => s.focusCanvasNode)
  const [collapsed, setCollapsed] = useState(false)

  const rows = useMemo<Row[]>(() => {
    if (!runningPtys.length) return []
    const ctx = { tabs, frames, projects }
    return runningPtys
      .map((ptyId) => locate(ptyId, ctx))
      .filter((l): l is NonNullable<typeof l> => !!l)
      .map((l) => ({
        ptyId: l.ptyId,
        leafId: l.leafId,
        frameId: l.frameId,
        nodeId: l.nodeId,
        project: l.project,
        term: shortName(l.term)
      }))
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
