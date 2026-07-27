// 左上角的「谁在自动跑」提示。
//
// 刻意做得极不显眼：小字、低透明度、无背景，只在鼠标移上去才提亮。
// 它是余光里的一条信息（「哦，那边还在跑」），不是需要处理的通知——
// 需要你处理的事有标题栏铃铛，两者不要抢注意力。
import { useMemo } from 'react'
import { useStore } from '../../store'
import { collectLeaves } from '../../layout'

/** 终端名只留前 5 个字：左上角就这么点地方，名字长了会把项目名挤没。
 *  先剥掉开头的盲文 spinner（⠋⠙⠹…）—— agent 干活时会把它写进标题，
 *  直接显示就成了「⠹ Ref…」，五个字被转圈字符占掉一个还难看。 */
function shortName(s: string): string {
  const t = s.replace(/^[⠀-⣿\s]+/u, '').trim()
  return t.length > 5 ? t.slice(0, 5) + '…' : t
}

interface Row {
  ptyId: string
  project: string
  term: string
}

export function AgentProgress(): JSX.Element | null {
  const runningPtys = useStore((s) => s.runningPtys)
  const tabs = useStore((s) => s.tabs)
  const projects = useStore((s) => s.projects)
  const frames = useStore((s) => s.canvas.frames)

  const rows = useMemo<Row[]>(() => {
    if (!runningPtys.length) return []
    const running = new Set(runningPtys)
    const out: Row[] = []
    for (const t of tabs) {
      for (const leaf of collectLeaves(t.root)) {
        if (leaf.pane.kind !== 'terminal') continue
        const ptyId = leaf.pane.ptyId
        if (!running.has(ptyId)) continue
        // 终端名优先取画布节点的自定义名（用户自己起的），否则用标签名。
        // 标签名此刻多半是 agent 写的 spinner 标题，取不到自定义名时也认了。
        const node = frames.flatMap((f) => f.nodes).find((n) => n.leafId === leaf.id)
        out.push({
          ptyId,
          project: projects.find((p) => p.id === t.projectId)?.name ?? '未归属',
          term: shortName(node?.name || t.title || '终端')
        })
      }
    }
    return out
  }, [runningPtys, tabs, projects, frames])

  if (!rows.length) return null

  const first = rows[0]
  const more = rows.length - 1

  return (
    <div
      className="agent-progress"
      data-tip={rows.map((r) => `${r.project} · ${r.term}`).join('\n')}
    >
      <span className="ap-dot" />
      <span className="ap-text">
        {first.project} · {first.term} · 任务进行中
      </span>
      {more > 0 && <span className="ap-more">+{more}</span>}
    </div>
  )
}
