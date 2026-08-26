// 分屏模式的「任务完成」通知（对应画布抽屉的待处理气泡）。
// CLI 任务完成会 flagAttention(ptyId)（标题 spinner→非 spinner 且未聚焦）；
// 响铃（onBell）和 MCP notify 打的是同一个标记，但它们能在终端**还在跑**的时候打
// —— 那种也要在这儿亮，判据见下面的 row.attn。
// 这里在标题栏亮一个铃铛 + 计数（有几个项目有待处理任务）；点击「依次」跳到下一个待处理项目
// 里最该看的那个终端——保可见、只清被点的那一个，统一交给 focusTerminal（见
// features/status/useStatus.ts）。原来这里在 setActiveProject 之后又手动把整个项目
// 所有终端的提醒都 clearAttention 掉，和 focusTerminal 修掉的那个不对称是同一个问题，
// 现在改走同一道门，不再自己维护一份「跳过去 + 清状态」。
import { useStore } from '../../store'
import { useProjectRows, focusTerminal } from '../status/useStatus.ts'

export function TerminalAttention(): JSX.Element | null {
  const activeProjectId = useStore((s) => s.activeProjectId)
  // 判据是 attn（这个项目有几个终端在等你），**不是 `top !== 'running'`**。
  // 后者曾经是这里的写法，代价是「agent 还在跑但主动叫了你」整类不亮——
  // 而 MCP notify 几乎总是在跑着的时候调（agent 调工具那一刻 spinner 正转着）。
  // 两者的区别与为什么能这么判，见 machine.ts 的 ProjectRow 注释。
  // rows 已经按 approval > done、同档内最近变化在前排好序，「依次」点下去天然是
  // 「最急的、最新的先来」，不用再按 projects 展示顺序自己拼一遍。
  const rows = useProjectRows().filter((r) => r.attn > 0)

  if (!rows.length) return null

  const jump = (): void => {
    // 依次：优先跳到「非当前」的待处理项目，否则第一个
    const row = rows.find((r) => r.projectId !== activeProjectId) ?? rows[0]
    focusTerminal(row.focusPtyId)
  }

  return (
    <button className="tb-item" data-tip="有任务完成，点击跳到该项目" onClick={jump}>
      待处理
      <span className="tb-badge">{rows.length}</span>
    </button>
  )
}
