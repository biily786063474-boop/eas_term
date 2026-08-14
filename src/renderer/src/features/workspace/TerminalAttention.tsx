// 分屏模式的「任务完成」通知（对应画布抽屉的待处理气泡）。
// CLI 任务完成会 flagAttention(ptyId)（标题 spinner→非 spinner 且未聚焦）。
// 响铃（onBell）和 MCP notify 也打同一个标记，但它们能在终端**还在跑**的时候打，
// 而下面按 top !== 'running' 过滤，所以那两种来源要等这个终端真停下来才在这里亮
// —— 见 mcpHandler.ts 的 notify 分支，那是个已知落差、单独立项跟进。
// 这里在标题栏亮一个铃铛 + 计数（有几个项目有待处理任务）；点击「依次」跳到下一个待处理项目
// 里最该看的那个终端——保可见、只清被点的那一个，统一交给 focusTerminal（见
// features/status/useStatus.ts）。原来这里在 setActiveProject 之后又手动把整个项目
// 所有终端的提醒都 clearAttention 掉，和 focusTerminal 修掉的那个不对称是同一个问题，
// 现在改走同一道门，不再自己维护一份「跳过去 + 清状态」。
import { useStore } from '../../store'
import { BellIcon } from '../../ui/Icons'
import { useProjectRows, focusTerminal } from '../status/useStatus.ts'

export function TerminalAttention(): JSX.Element | null {
  const activeProjectId = useStore((s) => s.activeProjectId)
  // 只算「需处理」的项目（approval/done）——running 不算，同 CanvasDrawer 的呼吸判据。
  // rows 已经按 approval > done、同档内最近变化在前排好序，「依次」点下去天然是
  // 「最急的、最新的先来」，不用再按 projects 展示顺序自己拼一遍。
  const rows = useProjectRows().filter((r) => r.top !== 'running')

  if (!rows.length) return null

  const jump = (): void => {
    // 依次：优先跳到「非当前」的待处理项目，否则第一个
    const row = rows.find((r) => r.projectId !== activeProjectId) ?? rows[0]
    focusTerminal(row.focusPtyId)
  }

  return (
    <button className="term-attn" data-tip="有任务完成，点击跳到该项目" onClick={jump}>
      <BellIcon size={13} />
      <span className="term-attn-count">{rows.length}</span>
    </button>
  )
}
