// 分屏模式的「任务完成」通知（对应画布抽屉的待处理气泡）。
// CLI 任务完成会 flagAttention(ptyId)（标题 spinner→非 spinner 且未聚焦 / 响铃）。
// 这里在标题栏亮一个铃铛 + 计数（有几个项目有完成任务）；点击「依次」跳到下一个已完成项目的
// 项目标签（切项目 + 激活含完成终端的那个 tab），并清除该项目的提醒（= 用户到达该项目即消除）。
import { useMemo } from 'react'
import { useStore } from '../../store'
import { collectLeaves } from '../../layout'
import { BellIcon } from '../../ui/Icons'

export function TerminalAttention(): JSX.Element | null {
  const attentionPtys = useStore((s) => s.attentionPtys)
  const tabs = useStore((s) => s.tabs)
  const projects = useStore((s) => s.projects)
  const activeProjectId = useStore((s) => s.activeProjectId)
  const setActiveProject = useStore((s) => s.setActiveProject)
  const setActiveTab = useStore((s) => s.setActiveTab)
  const clearAttention = useStore((s) => s.clearAttention)

  // 有完成任务的项目 id（按 projects 展示顺序）
  const attnProjectIds = useMemo(() => {
    if (!attentionPtys.length) return []
    const attn = new Set(attentionPtys)
    const ids = new Set<string>()
    for (const t of tabs) {
      if (!t.projectId) continue
      if (
        collectLeaves(t.root).some(
          (l) => l.pane.kind === 'terminal' && attn.has((l.pane as { ptyId: string }).ptyId)
        )
      )
        ids.add(t.projectId)
    }
    return projects.filter((p) => ids.has(p.id)).map((p) => p.id)
  }, [attentionPtys, tabs, projects])

  if (!attnProjectIds.length) return null

  const jump = (): void => {
    // 依次：优先跳到「非当前」的已完成项目，否则第一个
    const nextId = attnProjectIds.find((id) => id !== activeProjectId) ?? attnProjectIds[0]
    const attn = new Set(attentionPtys)
    const projTabs = tabs.filter((t) => t.projectId === nextId)
    // 聚焦到含「完成终端」的那个 tab
    const tab = projTabs.find((t) =>
      collectLeaves(t.root).some(
        (l) => l.pane.kind === 'terminal' && attn.has((l.pane as { ptyId: string }).ptyId)
      )
    )
    setActiveProject(nextId)
    if (tab) setActiveTab(tab.id)
    // 到达该项目即清除其所有终端提醒（兜底 setActiveProject 已是当前项目时不触发的情况）
    projTabs
      .flatMap((t) => collectLeaves(t.root))
      .filter((l) => l.pane.kind === 'terminal')
      .forEach((l) => clearAttention((l.pane as { ptyId: string }).ptyId))
  }

  return (
    <button className="term-attn" data-tip="有任务完成，点击跳到该项目" onClick={jump}>
      <BellIcon size={13} />
      <span className="term-attn-count">{attnProjectIds.length}</span>
    </button>
  )
}
